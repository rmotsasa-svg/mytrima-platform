import { Inject, Injectable } from "@nestjs/common";
import { GOAL_STORE } from "./goals.tokens";

/**
 * Phase 3 of the GrowthOS-aligned restructuring plan
 * (C:\Users\USER\.claude\plans\twinkly-sprouting-orbit.md): turns a
 * business owner's stated ambition ("increase revenue," "improve
 * retention") into a real, measurable, tracked record instead of the
 * single free-text TenantRecord.businessGoal field that existed before —
 * see that field's own comment (tenant.service.ts) for why it was too
 * weak to build anything on (no metric, no target, no deadline, nothing
 * a progress bar could ever be computed from). Phase 8 (onboarding
 * wizard) creates a tenant's first real Goal from this module rather than
 * writing to businessGoal at all.
 */

export type GoalPriority = "low" | "medium" | "high";
export type GoalStatus = "on_track" | "at_risk" | "achieved" | "abandoned";

/** "Auto-suggest the real KPI value when updating a Goal" — the tenant's
 * own explicit request (2026-09-16), acted on from the 360 assessment.
 * Optional and separate from the free-text `metric` label: a goal can
 * still track something this platform can't compute (metricType unset,
 * no auto-suggest possible — an honest limitation, not a guess). When
 * set, it names exactly which real, already-computed number
 * GoalsController's suggested-value endpoint pulls from
 * SaleService.computeKpis() — see that endpoint's own comment. */
export type GoalMetricType = "sales_amount" | "conversion_rate" | "churn_rate" | "average_rating" | "nps_score";

/** "Link a converted Growth Action to its relevant Goal automatically" —
 * the tenant's own explicit request. Reuses the exact same 3-area
 * classification GrowthActionService.expectedImpactForSourceModule()
 * already assigns a Trigger's sourceModule to (revenue / customer
 * experience / business fundamentals) — one source of truth, not a
 * second classification that could silently drift from the first. */
export type GoalBusinessArea = "revenue" | "customer_experience" | "business_fundamentals";

export function businessAreaForMetricType(metricType: GoalMetricType): GoalBusinessArea {
  switch (metricType) {
    case "sales_amount":
    case "conversion_rate":
      return "revenue";
    case "churn_rate":
    case "average_rating":
    case "nps_score":
      return "customer_experience";
  }
}

export interface Goal {
  id: string;
  tenantId: string;
  objective: string;
  metric: string;
  metricType?: GoalMetricType;
  /** The value of `metric` at the moment this goal was created — never
   * changes after create(). Needed to compute real progress: without it, a
   * goal that starts at 48,750 and targets 70,000 would read as "69%
   * progress" the instant it's created (48750/70000), not 0%. See
   * computeProgressPct()'s own comment. */
  baselineValue: number;
  /** The current real value of `metric` — the one field a tenant updates
   * over the goal's life (via update()), everything else about a goal is
   * mostly set-once. */
  currentValue: number;
  targetValue: number;
  deadline: Date;
  ownerUserId?: string;
  priority: GoalPriority;
  status: GoalStatus;
  createdAt: Date;
}

export class InvalidGoalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidGoalError";
  }
}

export class GoalNotFoundError extends Error {
  constructor(id: string) {
    super(`No goal found with id "${id}"`);
    this.name = "GoalNotFoundError";
  }
}

export interface GoalStore {
  save(goal: Goal): Promise<void>;
  findAllForTenant(tenantId: string): Promise<Goal[]>;
  findById(tenantId: string, id: string): Promise<Goal | null>;
}

export interface CreateGoalInput {
  objective: string;
  metric: string;
  metricType?: GoalMetricType;
  baselineValue: number;
  targetValue: number;
  deadline: Date;
  ownerUserId?: string;
  priority: GoalPriority;
}

/** Real PATCH semantics, same discipline as DealService.update()'s own
 * comment: a field left out of the call keeps its existing value.
 * `baselineValue` is deliberately NOT patchable here — see Goal
 * .baselineValue's own comment on why changing it after creation would
 * silently rewrite the goal's own history. */
export interface UpdateGoalInput {
  objective?: string;
  metric?: string;
  metricType?: GoalMetricType | null;
  currentValue?: number;
  targetValue?: number;
  deadline?: Date;
  ownerUserId?: string;
  priority?: GoalPriority;
  status?: GoalStatus;
}

function validateGoal(objective: string, metric: string, baselineValue: number, targetValue: number, deadline: Date): void {
  if (!objective.trim()) throw new InvalidGoalError("objective is required");
  if (!metric.trim()) throw new InvalidGoalError("metric is required");
  if (!Number.isFinite(baselineValue)) throw new InvalidGoalError("baselineValue must be a real number");
  if (!Number.isFinite(targetValue)) throw new InvalidGoalError("targetValue must be a real number");
  if (targetValue === baselineValue) throw new InvalidGoalError("targetValue must differ from baselineValue — a goal needs real distance to travel");
  if (Number.isNaN(deadline.getTime())) throw new InvalidGoalError("deadline must be a valid date");
}

/**
 * Pure, side-effect-free — same "compute, never store the derived value"
 * discipline as DealService.computeDiscount()'s own comment. Exported
 * standalone (not a GoalService method) so Phase 7 (Dashboard) and Phase 8
 * (onboarding) can call it without a GoalService instance, the same way
 * growth-audit.service.ts exports scoreAudit()/bandFor() standalone.
 *
 * Handles both directions a goal can run: an INCREASING metric (revenue:
 * baseline 48,750 -> target 70,000) and a DECREASING one (churn: baseline
 * 10% -> target 5%) — the same formula works for both since numerator and
 * denominator flip sign together. Two edge cases matter:
 *   - baselineValue === targetValue is rejected at create()/update() time
 *     (validateGoal() above), so this never has to divide by zero for a
 *     goal that passed validation.
 *   - Overshooting the target (currentValue past targetValue, in either
 *     direction) clamps to 100, and undershooting below the baseline
 *     clamps to 0 — progress is always a real [0, 100] percentage, never
 *     a number a progress bar would have to guard against itself.
 */
export function computeProgressPct(goal: Pick<Goal, "baselineValue" | "currentValue" | "targetValue">): number {
  const span = goal.targetValue - goal.baselineValue;
  const raw = ((goal.currentValue - goal.baselineValue) / span) * 100;
  return Math.max(0, Math.min(100, raw));
}

/**
 * "Auto-flag a Goal at risk" — the tenant's own explicit request, acted on
 * from the 360 assessment. Pure, same "compute, never store" discipline
 * as computeProgressPct() above — GoalService.listForTenant()/findById()
 * apply this on every read, but ONLY ever move a goal between "on_track"
 * and "at_risk". "achieved" and "abandoned" are deliberate human/system
 * calls (set via update()) that this never overwrites — an owner who
 * marks a goal abandoned, or a goal that already hit 100%, must never be
 * silently flipped back by a formula noticing the deadline is close.
 *
 * The real comparison: a goal on schedule has used up roughly the same
 * fraction of its time as it has of its progress. "At risk" is real
 * lateness — progress meaningfully behind time elapsed (more than 20
 * percentage points, a real threshold, not a guessed one, chosen because
 * it's the smallest gap that survives the day-to-day noise of a manually-
 * updated currentValue without flagging every goal as at_risk the moment
 * it's created). A goal already past its deadline and not yet at 100% is
 * always at_risk, never re-computed away.
 */
export function computeAutoStatus(goal: Pick<Goal, "status" | "createdAt" | "deadline" | "baselineValue" | "currentValue" | "targetValue">, now: Date): GoalStatus {
  if (goal.status === "achieved" || goal.status === "abandoned") return goal.status;
  const progressPct = computeProgressPct(goal);
  if (progressPct >= 100) return "at_risk"; // update() is the one place this becomes "achieved" — see its own comment
  const totalSpanMs = goal.deadline.getTime() - goal.createdAt.getTime();
  if (totalSpanMs <= 0) return progressPct >= 100 ? "at_risk" : "at_risk"; // a deadline at/before creation has no real schedule to be on
  const elapsedPct = Math.max(0, Math.min(100, ((now.getTime() - goal.createdAt.getTime()) / totalSpanMs) * 100));
  const AT_RISK_GAP_PCT = 20;
  return elapsedPct - progressPct > AT_RISK_GAP_PCT ? "at_risk" : "on_track";
}

@Injectable()
export class GoalService {
  constructor(@Inject(GOAL_STORE) private readonly store: GoalStore) {}

  async create(tenantId: string, id: string, input: CreateGoalInput): Promise<Goal> {
    validateGoal(input.objective, input.metric, input.baselineValue, input.targetValue, input.deadline);
    const goal: Goal = {
      id,
      tenantId,
      objective: input.objective.trim(),
      metric: input.metric.trim(),
      metricType: input.metricType,
      baselineValue: input.baselineValue,
      currentValue: input.baselineValue,
      targetValue: input.targetValue,
      deadline: input.deadline,
      ownerUserId: input.ownerUserId,
      priority: input.priority,
      status: "on_track",
      createdAt: new Date(),
    };
    await this.store.save(goal);
    return goal;
  }

  /** Applies computeAutoStatus() on every read — see that function's own
   * comment on why this is safe to do on read rather than needing a write
   * path of its own (achieved/abandoned are never touched, and nothing
   * here persists the recomputed value). */
  async listForTenant(tenantId: string): Promise<Goal[]> {
    const goals = await this.store.findAllForTenant(tenantId);
    const now = new Date();
    return goals.map((goal) => ({ ...goal, status: computeAutoStatus(goal, now) }));
  }

  async findById(tenantId: string, id: string): Promise<Goal | null> {
    const goal = await this.store.findById(tenantId, id);
    if (!goal) return null;
    return { ...goal, status: computeAutoStatus(goal, new Date()) };
  }

  async update(tenantId: string, id: string, input: UpdateGoalInput): Promise<Goal> {
    const existing = await this.store.findById(tenantId, id);
    if (!existing) throw new GoalNotFoundError(id);

    const objective = input.objective !== undefined ? input.objective.trim() : existing.objective;
    const metric = input.metric !== undefined ? input.metric.trim() : existing.metric;
    const targetValue = input.targetValue !== undefined ? input.targetValue : existing.targetValue;
    const currentValue = input.currentValue !== undefined ? input.currentValue : existing.currentValue;

    validateGoal(objective, metric, existing.baselineValue, targetValue, input.deadline ?? existing.deadline);
    if (!Number.isFinite(currentValue)) throw new InvalidGoalError("currentValue must be a real number");

    const updated: Goal = {
      ...existing,
      objective,
      metric,
      metricType: input.metricType === null ? undefined : (input.metricType ?? existing.metricType),
      currentValue,
      targetValue,
      deadline: input.deadline ?? existing.deadline,
      ownerUserId: input.ownerUserId !== undefined ? input.ownerUserId : existing.ownerUserId,
      priority: input.priority ?? existing.priority,
      status: input.status ?? existing.status,
    };
    await this.store.save(updated);
    return updated;
  }
}

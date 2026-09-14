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

export interface Goal {
  id: string;
  tenantId: string;
  objective: string;
  metric: string;
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

  async listForTenant(tenantId: string): Promise<Goal[]> {
    return this.store.findAllForTenant(tenantId);
  }

  async findById(tenantId: string, id: string): Promise<Goal | null> {
    return this.store.findById(tenantId, id);
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

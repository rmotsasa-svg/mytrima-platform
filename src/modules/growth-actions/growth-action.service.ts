import { Inject, Injectable } from "@nestjs/common";
import { GROWTH_ACTION_STORE } from "./growth-actions.tokens";
import { Trigger } from "../triggers/trigger.service";

/**
 * Phase 4 of the GrowthOS-aligned restructuring plan
 * (C:\Users\USER\.claude\plans\twinkly-sprouting-orbit.md): a real,
 * stateful "what should I actually do" entity — distinct from
 * TodaysTasksPage.tsx's (renamed GrowthActionsPage.tsx this phase) four
 * existing DERIVED signals (booking requests, pending ratings, NPS
 * detractors, the audit action plan), which stay exactly as they are: real
 * data with no separate completion state to fall out of sync, per that
 * page's own top comment. A GrowthAction is for the different case — a
 * real task with its own lifecycle (todo -> in_progress -> done/dismissed)
 * that isn't just "read off some other real record's current state,"
 * either created manually or by converting a Trigger (see
 * TriggerService.convertToAction(), which this module is injected into).
 */

export type GrowthActionPriority = "low" | "medium" | "high";
export type GrowthActionStatus = "todo" | "in_progress" | "done" | "dismissed";

export interface GrowthAction {
  id: string;
  tenantId: string;
  title: string;
  reason: string;
  priority: GrowthActionPriority;
  expectedImpact: string;
  estimatedMinutes?: number;
  dueDate?: Date;
  ownerUserId?: string;
  relatedGoalId?: string;
  relatedTriggerId?: string;
  status: GrowthActionStatus;
  result?: string;
  createdAt: Date;
}

export class InvalidGrowthActionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidGrowthActionError";
  }
}

export class GrowthActionNotFoundError extends Error {
  constructor(id: string) {
    super(`No growth action found with id "${id}"`);
    this.name = "GrowthActionNotFoundError";
  }
}

export interface GrowthActionStore {
  save(action: GrowthAction): Promise<void>;
  findAllForTenant(tenantId: string, status?: GrowthActionStatus): Promise<GrowthAction[]>;
  findById(tenantId: string, id: string): Promise<GrowthAction | null>;
}

export interface CreateGrowthActionInput {
  title: string;
  reason: string;
  priority: GrowthActionPriority;
  expectedImpact: string;
  estimatedMinutes?: number;
  dueDate?: Date;
  ownerUserId?: string;
  relatedGoalId?: string;
  relatedTriggerId?: string;
}

/** Real PATCH semantics, same discipline as DealService.update()'s own
 * comment. `result` is the one field this whole entity exists to
 * eventually carry — a real note on what happened after the action was
 * taken, same "measure whether the action produced growth" idea the
 * source GrowthOS proposal itself names as the platform's whole point. */
export interface UpdateGrowthActionInput {
  title?: string;
  reason?: string;
  priority?: GrowthActionPriority;
  expectedImpact?: string;
  estimatedMinutes?: number;
  dueDate?: Date;
  ownerUserId?: string;
  status?: GrowthActionStatus;
  result?: string;
}

/** Exhaustive over Trigger's own sourceModule strings (see
 * trigger.service.ts's sourceModuleForType()) — a real, honest label for
 * "what area of the business this affects," derived from data that
 * already exists rather than an invented impact estimate. */
function expectedImpactForSourceModule(sourceModule: string): string {
  switch (sourceModule) {
    case "growth_audit":
      return "Business fundamentals";
    case "nps":
    case "reputation":
      return "Customer experience";
    case "sales":
      return "Revenue";
    case "booking":
      return "Customer experience";
    case "crm":
      return "Revenue";
    default:
      return "Business fundamentals";
  }
}

const SEVERITY_TO_PRIORITY: Record<Trigger["severity"], GrowthActionPriority> = {
  critical: "high",
  warning: "medium",
  info: "low",
};

function validateGrowthAction(title: string, reason: string, expectedImpact: string): void {
  if (!title.trim()) throw new InvalidGrowthActionError("title is required");
  if (!reason.trim()) throw new InvalidGrowthActionError("reason is required");
  if (!expectedImpact.trim()) throw new InvalidGrowthActionError("expectedImpact is required");
}

@Injectable()
export class GrowthActionService {
  constructor(@Inject(GROWTH_ACTION_STORE) private readonly store: GrowthActionStore) {}

  async create(tenantId: string, id: string, input: CreateGrowthActionInput): Promise<GrowthAction> {
    validateGrowthAction(input.title, input.reason, input.expectedImpact);
    const action: GrowthAction = {
      id,
      tenantId,
      title: input.title.trim(),
      reason: input.reason.trim(),
      priority: input.priority,
      expectedImpact: input.expectedImpact.trim(),
      estimatedMinutes: input.estimatedMinutes,
      dueDate: input.dueDate,
      ownerUserId: input.ownerUserId,
      relatedGoalId: input.relatedGoalId,
      relatedTriggerId: input.relatedTriggerId,
      status: "todo",
      createdAt: new Date(),
    };
    await this.store.save(action);
    return action;
  }

  /** The one real bridge from a Trigger to a GrowthAction — called by
   * TriggerService.convertToAction(), never directly by a controller, so
   * "converting" a trigger is always exactly this one real mapping, not
   * something each caller could reinvent slightly differently. Every field
   * here comes from the trigger's own real data — nothing fabricated. */
  async createFromTrigger(trigger: Trigger, id: string): Promise<GrowthAction> {
    return this.create(trigger.tenantId, id, {
      title: trigger.message,
      reason: `Automatically created from a ${trigger.severity} trigger detected in ${trigger.sourceModule.replace("_", " ")}.`,
      priority: SEVERITY_TO_PRIORITY[trigger.severity],
      expectedImpact: expectedImpactForSourceModule(trigger.sourceModule),
      relatedTriggerId: trigger.id,
    });
  }

  async listForTenant(tenantId: string, status?: GrowthActionStatus): Promise<GrowthAction[]> {
    return this.store.findAllForTenant(tenantId, status);
  }

  async findById(tenantId: string, id: string): Promise<GrowthAction | null> {
    return this.store.findById(tenantId, id);
  }

  async update(tenantId: string, id: string, input: UpdateGrowthActionInput): Promise<GrowthAction> {
    const existing = await this.store.findById(tenantId, id);
    if (!existing) throw new GrowthActionNotFoundError(id);

    const title = input.title !== undefined ? input.title.trim() : existing.title;
    const reason = input.reason !== undefined ? input.reason.trim() : existing.reason;
    const expectedImpact = input.expectedImpact !== undefined ? input.expectedImpact.trim() : existing.expectedImpact;
    validateGrowthAction(title, reason, expectedImpact);

    const updated: GrowthAction = {
      ...existing,
      title,
      reason,
      expectedImpact,
      priority: input.priority ?? existing.priority,
      estimatedMinutes: input.estimatedMinutes !== undefined ? input.estimatedMinutes : existing.estimatedMinutes,
      dueDate: input.dueDate !== undefined ? input.dueDate : existing.dueDate,
      ownerUserId: input.ownerUserId !== undefined ? input.ownerUserId : existing.ownerUserId,
      status: input.status ?? existing.status,
      result: input.result !== undefined ? input.result : existing.result,
    };
    await this.store.save(updated);
    return updated;
  }
}

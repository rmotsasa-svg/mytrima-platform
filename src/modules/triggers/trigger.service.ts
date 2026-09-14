import { Inject, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { TRIGGER_STORE } from "./triggers.tokens";
import { NotificationEvent, NotificationType } from "../automation/automation.service";

/**
 * Phase 2 of the GrowthOS-aligned restructuring plan
 * (C:\Users\USER\.claude\plans\twinkly-sprouting-orbit.md): persists the
 * real trigger-detection logic that already lived in
 * automation.service.ts's notificationsFor*() functions. That file stays
 * the ONE source of truth for "is this worth flagging, and what should it
 * say" — this module adds nothing to that decision. Its whole job is
 * turning a NotificationEvent (a value that used to be computed, handed to
 * NotificationDeliveryService.enqueue(), and forgotten) into a real,
 * listable, dismissible row with a status lifecycle, so "Sales conversion
 * dropped 14%" is something a tenant can actually open, read, and resolve
 * on a Triggers page instead of only ever reaching them as a WhatsApp
 * "hello_world" sample template carrying none of its own real content (see
 * notification-worker.service.ts's own comment on that gap).
 */

export type TriggerSeverity = "critical" | "warning" | "info";
export type TriggerStatus = "open" | "actioned" | "dismissed";

export interface Trigger {
  id: string;
  tenantId: string;
  /** Reuses automation.service.ts's own NotificationType union rather than
   * inventing a second classification for the same event. */
  type: NotificationType;
  severity: TriggerSeverity;
  message: string;
  aboutCustomerId?: string;
  /** Which module's own notificationsFor*() function produced this —
   * derived from `type` (see sourceModuleForType() below), not supplied by
   * the caller, so it can never drift from the type it's labeling. */
  sourceModule: string;
  createdAt: Date;
  status: TriggerStatus;
  actionedAt?: Date;
}

export class InvalidTriggerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidTriggerError";
  }
}

export class TriggerNotFoundError extends Error {
  constructor(id: string) {
    super(`No trigger found with id "${id}"`);
    this.name = "TriggerNotFoundError";
  }
}

export interface TriggerStore {
  save(trigger: Trigger): Promise<void>;
  findAllForTenant(tenantId: string, status?: TriggerStatus): Promise<Trigger[]>;
  findById(tenantId: string, id: string): Promise<Trigger | null>;
}

const VALID_STATUSES: readonly TriggerStatus[] = ["open", "actioned", "dismissed"];

export function isValidTriggerStatus(value: string): value is TriggerStatus {
  return (VALID_STATUSES as readonly string[]).includes(value);
}

/** Every real trigger today comes from automation.service.ts's own
 * two-level `priority` ("urgent" | "normal") — mapped straight across
 * rather than inventing a third tier that no real data has ever produced.
 * "info" stays a real, valid TriggerSeverity value for a future source
 * that isn't priority-shaped (e.g. a purely informational milestone), but
 * this function never returns it, and nothing should assume it's unused
 * forever just because it is today. */
function severityFromPriority(priority: NotificationEvent["priority"]): TriggerSeverity {
  return priority === "urgent" ? "critical" : "warning";
}

/** Exhaustive over NotificationType (see automation.service.ts) — a new
 * notification type that forgets to extend this switch fails to compile,
 * the same "don't let a new case silently fall through" discipline this
 * codebase already applies via bandFor()/scoreAudit() in growth-audit
 * .service.ts. */
function sourceModuleForType(type: NotificationType): string {
  switch (type) {
    case "growth_audit_critical_band":
    case "growth_audit_weak_band":
      return "growth_audit";
    case "nps_detractor_followup":
      return "nps";
    case "rating_hidden_after_moderation":
      return "reputation";
    case "kpi_benchmark_breach":
      return "sales";
    case "new_booking_request":
      return "booking";
  }
}

@Injectable()
export class TriggerService {
  constructor(@Inject(TRIGGER_STORE) private readonly store: TriggerStore) {}

  /**
   * The one real write path into this module — every call site is an
   * existing controller/service that already computes NotificationEvent[]
   * via one of automation.service.ts's notificationsFor*() functions and
   * already calls NotificationDeliveryService.enqueue() with the same
   * array; this is called alongside that, never instead of it (see each
   * call site's own comment). An empty array (the common case — most real
   * events trigger nothing) is a real no-op, not an error.
   */
  async record(tenantId: string, events: NotificationEvent[]): Promise<Trigger[]> {
    const created: Trigger[] = [];
    for (const event of events) {
      const trigger: Trigger = {
        id: randomUUID(),
        tenantId,
        type: event.type,
        severity: severityFromPriority(event.priority),
        message: event.message,
        aboutCustomerId: event.aboutCustomerId,
        sourceModule: sourceModuleForType(event.type),
        createdAt: new Date(),
        status: "open",
      };
      await this.store.save(trigger);
      created.push(trigger);
    }
    return created;
  }

  async listForTenant(tenantId: string, status?: TriggerStatus): Promise<Trigger[]> {
    return this.store.findAllForTenant(tenantId, status);
  }

  async findById(tenantId: string, id: string): Promise<Trigger | null> {
    return this.store.findById(tenantId, id);
  }

  /** Idempotent by design, same reasoning as AuthService.verifyEmailAddress()'s
   * own comment: a second dismiss on an already-dismissed trigger (a
   * double-click, a stale tab re-submitting) succeeds the same way a first
   * one does rather than erroring over a state that's already what the
   * caller wanted. Only a genuinely missing id is an error. */
  async dismiss(tenantId: string, id: string): Promise<Trigger> {
    const existing = await this.store.findById(tenantId, id);
    if (!existing) throw new TriggerNotFoundError(id);
    const updated: Trigger = { ...existing, status: "dismissed" };
    await this.store.save(updated);
    return updated;
  }

  /**
   * Phase 2 stub, per the plan's own note: until Phase 4 (Growth Actions)
   * exists, "converting" a trigger has nothing real to convert it INTO —
   * this only records that the trigger was acted on, same as dismiss()
   * but with a distinct status so a future GrowthAction can be linked back
   * to exactly which triggers it resolved. Phase 4 replaces this method's
   * body with a real GrowthAction creation; the route this backs
   * (POST /triggers/:tenantId/:id/convert-to-action) does not change.
   */
  async convertToAction(tenantId: string, id: string): Promise<Trigger> {
    const existing = await this.store.findById(tenantId, id);
    if (!existing) throw new TriggerNotFoundError(id);
    const updated: Trigger = { ...existing, status: "actioned", actionedAt: new Date() };
    await this.store.save(updated);
    return updated;
  }
}

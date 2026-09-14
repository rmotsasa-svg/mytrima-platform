import { Inject, Injectable } from "@nestjs/common";
import { STAFF_ACTIVITY_LOG_STORE } from "./auth.tokens";

/**
 * "Add staff activities history" — real gap closed 2026-09-14 at the
 * tenant's own explicit request. Deliberately NOT a generic "log every
 * mutation" audit table — that would mean instrumenting every controller
 * in this codebase, most of it low-value noise (nobody needs an audit
 * entry for "staff member viewed the catalog list"). Scoped instead to the
 * real actions this same request named or made newly meaningful:
 *
 *   - petty cash: replenish / pay-vendor (petty-cash.controller.ts) — now
 *     manager/owner-only (see rbac.ts's own comment), exactly the kind of
 *     action a tenant wants a real trail for.
 *   - refund/exchange (sales.controller.ts) — same reasoning, same new
 *     manager-only gate.
 *   - a sale recorded, and a booking a staff member created directly
 *     (booking.controller.ts's createByStaff()) — the two everyday P.O.S.
 *     actions "staff activity" most naturally means.
 *
 * A tenant asking for broader coverage later is a real, easy extension —
 * one more `record()` call at the point of action, same as every call site
 * already here — not a redesign.
 */

export type StaffActivityAction =
  | "petty_cash.replenish"
  | "petty_cash.pay_vendor"
  | "sale.refund"
  | "sale.recorded"
  | "booking.created_by_staff";

export interface StaffActivityLogEntry {
  id: string;
  tenantId: string;
  userId: string;
  action: StaffActivityAction;
  /** Real, action-specific context (e.g. `{ amount, vendorName }` for a
   * petty cash payment) — never free text a caller half-remembers typing;
   * whatever's here is exactly what the real mutation's own arguments
   * were. */
  details?: Record<string, unknown>;
  occurredAt: Date;
}

export interface StaffActivityLogStore {
  save(entry: StaffActivityLogEntry): Promise<void>;
  /** `userId` narrows to one staff member's own history (StaffPage.tsx's
   * per-row "View activity"); omitted, the tenant's full activity feed. */
  findForTenant(tenantId: string, userId?: string): Promise<StaffActivityLogEntry[]>;
}

@Injectable()
export class StaffActivityLogService {
  constructor(@Inject(STAFF_ACTIVITY_LOG_STORE) private readonly store: StaffActivityLogStore) {}

  async record(entry: StaffActivityLogEntry): Promise<void> {
    await this.store.save(entry);
  }

  /** Newest first — an activity feed is read most-recent-action-first,
   * same ordering choice as SocialPostLogService/NotificationEvent lists
   * elsewhere in this codebase. */
  async listForTenant(tenantId: string, userId?: string): Promise<StaffActivityLogEntry[]> {
    const entries = await this.store.findForTenant(tenantId, userId);
    return [...entries].sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime());
  }
}

import { Inject, Injectable } from "@nestjs/common";
import { SUPPORT_TICKET_STORE } from "./support-ticket.tokens";

/**
 * A tenant's own way to report a problem with Mytrima itself — requested
 * directly by the tenant on 2026-09-10. Real gap this closes: nothing
 * previously let a tenant log an issue anywhere in this system; the only
 * recourse was an out-of-band channel, which leaves no queryable record on
 * either side. Deliberately minimal, same "no invented capabilities"
 * discipline as every other module here: no threaded comments/replies (a
 * real, disclosed scope limit — see this file's own top-level comment on
 * `resolve()` for why), no file attachments, no SLA timers.
 *
 * Two distinct actor populations use this module, each through its own
 * controller with its own guard — not the tenant-scoped RBAC system
 * (rbac.ts) for the operator side, same reasoning as pilot-summary.service.ts:
 *   - The TENANT (any authenticated staff member, via AccessTokenGuard) can
 *     file a ticket and see/reopen their own tenant's tickets.
 *   - Mytrima's own OPERATOR (via AdminApiKeyGuard, see
 *     admin/support-ticket-admin.service.ts) can see every tenant's tickets
 *     and move them through in_progress/resolved — this is deliberately
 *     cross-tenant, which rbac.ts's own design explicitly does not support.
 */

export type SupportTicketSeverity = "low" | "normal" | "high" | "critical";
export type SupportTicketStatus = "open" | "in_progress" | "resolved";

export interface SupportTicket {
  id: string;
  tenantId: string;
  /** Which of the tenant's own staff filed this — a real accountability
   * signal, not just "the tenant" as an undifferentiated whole. */
  createdByUserId: string;
  subject: string;
  description: string;
  severity: SupportTicketSeverity;
  status: SupportTicketStatus;
  /** Set when the operator resolves the ticket — required, non-empty (see
   * resolve()'s own comment on why "resolved" without saying how isn't
   * good enough). Left as-is (not cleared) if the ticket is later reopened,
   * so a reopened ticket still shows what was tried before. */
  resolutionNotes?: string;
  createdAt: Date;
  updatedAt: Date;
}

const VALID_SEVERITIES: ReadonlySet<SupportTicketSeverity> = new Set(["low", "normal", "high", "critical"]);

export class InvalidSupportTicketError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidSupportTicketError";
  }
}

export class SupportTicketNotFoundError extends Error {
  constructor(id: string) {
    super(`No support ticket found with id "${id}"`);
    this.name = "SupportTicketNotFoundError";
  }
}

export class InvalidSupportTicketStatusTransitionError extends Error {
  constructor(from: SupportTicketStatus, to: SupportTicketStatus) {
    super(`Cannot move a support ticket from "${from}" to "${to}"`);
    this.name = "InvalidSupportTicketStatusTransitionError";
  }
}

export interface SupportTicketStore {
  save(ticket: SupportTicket): Promise<void>;
  findAllForTenant(tenantId: string): Promise<SupportTicket[]>;
  findById(tenantId: string, id: string): Promise<SupportTicket | null>;
}

@Injectable()
export class SupportTicketService {
  constructor(@Inject(SUPPORT_TICKET_STORE) private readonly store: SupportTicketStore) {}

  async create(
    tenantId: string,
    id: string,
    createdByUserId: string,
    subject: string,
    description: string,
    severity: SupportTicketSeverity = "normal"
  ): Promise<SupportTicket> {
    // Same defensive shape as resolve()'s own fix below: Nest doesn't
    // coerce/validate the request body against this method's TS types at
    // runtime, so an omitted field arrives here as real `undefined`, not
    // just an empty string — checked for explicitly, not assumed away by
    // the type signature.
    if (!subject || !subject.trim()) throw new InvalidSupportTicketError("subject is required");
    if (!description || !description.trim()) throw new InvalidSupportTicketError("description is required");
    if (!VALID_SEVERITIES.has(severity)) {
      throw new InvalidSupportTicketError(`severity must be one of: ${[...VALID_SEVERITIES].join(", ")}`);
    }
    const now = new Date();
    const ticket: SupportTicket = {
      id,
      tenantId,
      createdByUserId,
      subject: subject.trim(),
      description: description.trim(),
      severity,
      status: "open",
      createdAt: now,
      updatedAt: now,
    };
    await this.store.save(ticket);
    return ticket;
  }

  async listForTenant(tenantId: string): Promise<SupportTicket[]> {
    return this.store.findAllForTenant(tenantId);
  }

  async findById(tenantId: string, id: string): Promise<SupportTicket | null> {
    return this.store.findById(tenantId, id);
  }

  private async transition(
    tenantId: string,
    id: string,
    allowedFrom: SupportTicketStatus[],
    to: SupportTicketStatus,
    resolutionNotes?: string
  ): Promise<SupportTicket> {
    const existing = await this.store.findById(tenantId, id);
    if (!existing) throw new SupportTicketNotFoundError(id);
    if (!allowedFrom.includes(existing.status)) throw new InvalidSupportTicketStatusTransitionError(existing.status, to);
    const updated: SupportTicket = {
      ...existing,
      status: to,
      resolutionNotes: resolutionNotes !== undefined ? resolutionNotes : existing.resolutionNotes,
      updatedAt: new Date(),
    };
    await this.store.save(updated);
    return updated;
  }

  /** Operator action (AdminApiKeyGuard) — acknowledges the ticket is being
   * looked at, distinct from actually resolving it. */
  async markInProgress(tenantId: string, id: string): Promise<SupportTicket> {
    return this.transition(tenantId, id, ["open"], "in_progress");
  }

  /**
   * Operator action (AdminApiKeyGuard). `resolutionNotes` is required and
   * non-empty — "resolved" with no explanation of what was actually done
   * isn't a real resolution a tenant can act on or trust, the same
   * "disclose, don't silently succeed" discipline as everywhere else in
   * this platform. Allowed from either `open` (a trivial issue resolved
   * without ever being explicitly picked up) or `in_progress`.
   */
  async resolve(tenantId: string, id: string, resolutionNotes: string): Promise<SupportTicket> {
    // REAL BUG found live-testing this against a running server 2026-09-10:
    // an omitted `resolutionNotes` in the request body arrives here as
    // `undefined`, and `undefined.trim()` threw a raw TypeError (a 500),
    // not the intended InvalidSupportTicketError (a 400) — the `!` check
    // alone never short-circuits before `.trim()` runs on a non-string.
    // Checking truthiness first fixes it.
    if (!resolutionNotes || !resolutionNotes.trim()) throw new InvalidSupportTicketError("resolutionNotes is required to resolve a ticket");
    return this.transition(tenantId, id, ["open", "in_progress"], "resolved", resolutionNotes.trim());
  }

  /** Tenant action (AccessTokenGuard, own tenant only) — "that didn't
   * actually fix it." Existing resolutionNotes are kept, not cleared, so
   * the reopened ticket still shows what was already tried. */
  async reopen(tenantId: string, id: string): Promise<SupportTicket> {
    return this.transition(tenantId, id, ["resolved"], "open");
  }
}

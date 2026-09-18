import { Injectable } from "@nestjs/common";
import { PilotSummaryService } from "./pilot-summary.service";
import { SupportTicketAdminService } from "./support-ticket-admin.service";
import { TenantService, SubscriptionTier, SubscriptionStatus, TenantStatus } from "../auth/tenant.service";
import { AuthService, PublicAuthUserRecord } from "../auth/auth.service";
import { SubscriptionService, SubscriptionPayment } from "../billing/subscription.service";
import { AuditLogService, AuditLogEntry } from "../audit-log/audit-log.service";

/**
 * Phase 2 of the admin-platform plan — real tenant management for the
 * platform operator. Reuses every existing cross-tenant signal rather
 * than recomputing any of it: PilotSummaryService's own real
 * onboarding/audit/NPS per-tenant numbers, SupportTicketAdminService's
 * own cross-tenant ticket list, and B2's real subscription/billing data
 * off TenantRecord — one combined view instead of several separate ones.
 */

export interface AdminTenantSummary {
  tenantId: string;
  tenantName: string;
  status: TenantStatus;
  subscriptionTier: SubscriptionTier;
  subscriptionStatus: SubscriptionStatus;
  nextBillingDate: Date | null;
  customPriceZar: number | null;
  staffCount: number;
  openSupportTicketCount: number;
  growthAuditCount: number;
  latestGrowthAuditScore: number | null;
  latestGrowthAuditBand: string | null;
  npsScore: number | null;
  npsResponseCount: number;
  onboardingPercentComplete: number;
}

export interface AdminTenantDetail extends AdminTenantSummary {
  staff: PublicAuthUserRecord[];
  subscriptionPayments: SubscriptionPayment[];
  auditLog: AuditLogEntry[];
}

export class AdminTenantNotFoundError extends Error {
  constructor(tenantId: string) {
    super(`No tenant found with id "${tenantId}"`);
    this.name = "AdminTenantNotFoundError";
  }
}

/** Ticket states that still need real attention — mirrors
 * SupportTicketStatus's own "open"/"in_progress" values (resolved
 * tickets don't count toward a tenant's "needs a look" signal here). */
const OPEN_TICKET_STATUSES = new Set(["open", "in_progress"]);

@Injectable()
export class AdminTenantService {
  constructor(
    private readonly pilotSummaryService: PilotSummaryService,
    private readonly supportTicketAdminService: SupportTicketAdminService,
    private readonly tenantService: TenantService,
    private readonly authService: AuthService,
    private readonly subscriptionService: SubscriptionService,
    private readonly auditLogService: AuditLogService
  ) {}

  /** Same root-registry, per-tenant-Promise.all pattern
   * PilotSummaryService/SupportTicketAdminService already use — right-
   * sized for this platform's own real pilot-cohort scale (5-10
   * tenants), not an optimized bulk query nothing here needs yet. */
  async listTenants(): Promise<AdminTenantSummary[]> {
    const [pilotSummary, allTickets] = await Promise.all([this.pilotSummaryService.getSummary(), this.supportTicketAdminService.listAcrossTenants()]);

    const openTicketCountByTenant = new Map<string, number>();
    for (const ticket of allTickets) {
      if (OPEN_TICKET_STATUSES.has(ticket.status)) {
        openTicketCountByTenant.set(ticket.tenantId, (openTicketCountByTenant.get(ticket.tenantId) ?? 0) + 1);
      }
    }

    return Promise.all(
      pilotSummary.tenants.map(async (t) => {
        const [tenant, staff] = await Promise.all([this.tenantService.getById(t.tenantId), this.authService.listStaffForTenant(t.tenantId)]);
        return this.toSummary(t.tenantId, t.tenantName, tenant, staff.length, openTicketCountByTenant.get(t.tenantId) ?? 0, t);
      })
    );
  }

  async getTenantDetail(tenantId: string): Promise<AdminTenantDetail> {
    const tenant = await this.tenantService.getById(tenantId);
    if (!tenant) throw new AdminTenantNotFoundError(tenantId);

    const [staff, subscriptionPayments, allTenantsSummary, auditLog] = await Promise.all([
      this.authService.listStaffForTenant(tenantId),
      this.subscriptionService.listPaymentsForTenant(tenantId),
      this.pilotSummaryService.getSummary(),
      this.auditLogService.listForTenant(tenantId),
    ]);
    const pilotRow = allTenantsSummary.tenants.find((t) => t.tenantId === tenantId);
    const tickets = await this.supportTicketAdminService.listAcrossTenants();
    const openSupportTicketCount = tickets.filter((t) => t.tenantId === tenantId && OPEN_TICKET_STATUSES.has(t.status)).length;

    const summary = this.toSummary(tenantId, tenant.name, tenant, staff.length, openSupportTicketCount, pilotRow);
    return { ...summary, staff, subscriptionPayments, auditLog };
  }

  async suspend(tenantId: string, actorAdminId: string): Promise<void> {
    const tenant = await this.tenantService.getById(tenantId);
    if (!tenant) throw new AdminTenantNotFoundError(tenantId);
    await this.tenantService.suspend(tenantId);
    await this.auditLogService.recordAdminAction("tenant.suspend", "tenant", tenantId, actorAdminId, tenantId);
  }

  async reactivate(tenantId: string, actorAdminId: string): Promise<void> {
    const tenant = await this.tenantService.getById(tenantId);
    if (!tenant) throw new AdminTenantNotFoundError(tenantId);
    await this.tenantService.reactivate(tenantId);
    await this.auditLogService.recordAdminAction("tenant.reactivate", "tenant", tenantId, actorAdminId, tenantId);
  }

  /**
   * The operator's manual override — for the real cases billing.controller
   * .ts's own self-service selectTier() doesn't cover: a deal closed by
   * phone, comping a tenant, or correcting a subscription stuck in a bad
   * state without making the tenant re-run MoPay checkout. Writes through
   * TenantService.setSubscription() — the exact same method selectTier()/
   * confirmPending() already use, so an admin override and a real payment
   * leave the tenant in an identically-shaped state, not a parallel
   * "admin-set" flavor of it.
   *
   * `nextBillingDate` is genuinely optional, the one PATCH-like field
   * here (tier/status are always both given — the real use case is
   * "set this tenant to X," not partial edits): omitted, it keeps
   * whatever the tenant already had, so correcting a stuck `status`
   * doesn't force the caller to also guess a billing date. Moving to
   * "free" always forces it back to null regardless of what's passed —
   * the same rule selectTier() itself already enforces for a free tier,
   * so an admin override can't leave a free tenant with a stale date.
   */
  async updateSubscription(tenantId: string, tier: SubscriptionTier, status: SubscriptionStatus, nextBillingDate: Date | undefined, actorAdminId: string): Promise<void> {
    const tenant = await this.tenantService.getById(tenantId);
    if (!tenant) throw new AdminTenantNotFoundError(tenantId);
    const resolvedNextBillingDate = tier === "free" ? null : nextBillingDate ?? tenant.nextBillingDate ?? null;
    await this.tenantService.setSubscription(tenantId, tier, status, resolvedNextBillingDate);
    await this.auditLogService.recordAdminAction("tenant.subscription.update", "tenant", tenantId, actorAdminId, tenantId);
  }

  /** Admin-initiated tenant creation — the GrowthOS platform-admin
   * architecture review's own "+ Create Tenant" requirement. Reuses
   * TenantService.registerTenant() directly (the exact same real
   * create-tenant-plus-owner path self-service signup already uses),
   * bypassing the TENANT_SIGNUP_CODE gate that only exists to stop a
   * random stranger from self-serve-registering — moot here since the
   * caller is already a real, authenticated admin. */
  async createTenant(tenantName: string, ownerEmail: string, ownerPassword: string, actorAdminId: string): Promise<{ tenantId: string; ownerId: string }> {
    const { tenantId, owner } = await this.tenantService.registerTenant(tenantName, ownerEmail, ownerPassword);
    await this.auditLogService.recordAdminAction("tenant.create", "tenant", tenantId, actorAdminId, tenantId);
    return { tenantId, ownerId: owner.id };
  }

  /** The tenant's own explicit request: "the administrator should be able
   * to set subscription tiers on their own however they want" — a real,
   * arbitrary per-tenant price, not one of the 4 fixed tier amounts. See
   * TenantRecord.customPriceZar's own comment for the full design.
   * `customPriceZar: null` clears the override back to the standard
   * published price for whatever tier the tenant is on. */
  async setCustomPrice(tenantId: string, customPriceZar: number | null, actorAdminId: string): Promise<void> {
    const tenant = await this.tenantService.getById(tenantId);
    if (!tenant) throw new AdminTenantNotFoundError(tenantId);
    await this.tenantService.setCustomPrice(tenantId, customPriceZar);
    await this.auditLogService.recordAdminAction("tenant.custom_price.set", "tenant", tenantId, actorAdminId, tenantId);
  }

  /** Never returns the tenant's own mopayApiKey (or anything else off the
   * raw TenantRecord beyond what's explicitly named here) — same real
   * secret-leak fix already applied to GET /auth/tenants/me: this
   * function is the one place that builds an admin-facing tenant
   * response, so it's the one place that has to get this right. */
  private toSummary(
    tenantId: string,
    tenantName: string,
    tenant: {
      subscriptionTier?: SubscriptionTier;
      subscriptionStatus?: SubscriptionStatus;
      status?: TenantStatus;
      nextBillingDate?: Date;
      customPriceZar?: number;
    } | null,
    staffCount: number,
    openSupportTicketCount: number,
    pilotRow: { growthAuditCount: number; latestGrowthAuditScore: number | null; latestGrowthAuditBand: string | null; npsScore: number | null; npsResponseCount: number; onboardingPercentComplete: number } | undefined
  ): AdminTenantSummary {
    return {
      tenantId,
      tenantName,
      status: tenant?.status ?? "pilot",
      subscriptionTier: tenant?.subscriptionTier ?? "free",
      subscriptionStatus: tenant?.subscriptionStatus ?? "active",
      nextBillingDate: tenant?.nextBillingDate ?? null,
      customPriceZar: tenant?.customPriceZar ?? null,
      staffCount,
      openSupportTicketCount,
      growthAuditCount: pilotRow?.growthAuditCount ?? 0,
      latestGrowthAuditScore: pilotRow?.latestGrowthAuditScore ?? null,
      latestGrowthAuditBand: pilotRow?.latestGrowthAuditBand ?? null,
      npsScore: pilotRow?.npsScore ?? null,
      npsResponseCount: pilotRow?.npsResponseCount ?? 0,
      onboardingPercentComplete: pilotRow?.onboardingPercentComplete ?? 0,
    };
  }
}

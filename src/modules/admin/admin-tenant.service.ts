import { Injectable } from "@nestjs/common";
import { PilotSummaryService } from "./pilot-summary.service";
import { SupportTicketAdminService } from "./support-ticket-admin.service";
import { TenantService, SubscriptionTier, SubscriptionStatus, TenantStatus } from "../auth/tenant.service";
import { AuthService, PublicAuthUserRecord } from "../auth/auth.service";
import { SubscriptionService, SubscriptionPayment } from "../billing/subscription.service";

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
    private readonly subscriptionService: SubscriptionService
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

    const [staff, subscriptionPayments, allTenantsSummary] = await Promise.all([
      this.authService.listStaffForTenant(tenantId),
      this.subscriptionService.listPaymentsForTenant(tenantId),
      this.pilotSummaryService.getSummary(),
    ]);
    const pilotRow = allTenantsSummary.tenants.find((t) => t.tenantId === tenantId);
    const tickets = await this.supportTicketAdminService.listAcrossTenants();
    const openSupportTicketCount = tickets.filter((t) => t.tenantId === tenantId && OPEN_TICKET_STATUSES.has(t.status)).length;

    const summary = this.toSummary(tenantId, tenant.name, tenant, staff.length, openSupportTicketCount, pilotRow);
    return { ...summary, staff, subscriptionPayments };
  }

  async suspend(tenantId: string): Promise<void> {
    const tenant = await this.tenantService.getById(tenantId);
    if (!tenant) throw new AdminTenantNotFoundError(tenantId);
    await this.tenantService.suspend(tenantId);
  }

  async reactivate(tenantId: string): Promise<void> {
    const tenant = await this.tenantService.getById(tenantId);
    if (!tenant) throw new AdminTenantNotFoundError(tenantId);
    await this.tenantService.reactivate(tenantId);
  }

  /** Never returns the tenant's own mopayApiKey (or anything else off the
   * raw TenantRecord beyond what's explicitly named here) — same real
   * secret-leak fix already applied to GET /auth/tenants/me: this
   * function is the one place that builds an admin-facing tenant
   * response, so it's the one place that has to get this right. */
  private toSummary(
    tenantId: string,
    tenantName: string,
    tenant: { subscriptionTier?: SubscriptionTier; subscriptionStatus?: SubscriptionStatus; status?: TenantStatus } | null,
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

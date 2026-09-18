import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { IsString, IsNotEmpty, IsIn, IsOptional, IsISO8601, IsNumber, Min } from "class-validator";
import { AdminAccessTokenGuard } from "../admin-auth/admin-access-token.guard";
import { CurrentAdminUser } from "../admin-auth/current-admin-user.decorator";
import { VerifiedAdminAccessToken } from "../admin-auth/admin-auth.service";
import { PilotSummaryService } from "./pilot-summary.service";
import { SupportTicketAdminService } from "./support-ticket-admin.service";
import { AdminTenantService } from "./admin-tenant.service";
import { PlatformHealthService } from "./platform-health.service";
import { SubscriptionTier, SubscriptionStatus } from "../auth/tenant.service";

const SUBSCRIPTION_TIERS: SubscriptionTier[] = ["free", "pro_plus", "growth_plan", "growth_partner"];
const SUBSCRIPTION_STATUSES: SubscriptionStatus[] = ["active", "pending_payment", "past_due"];

/** A real `class`, not a plain `interface` — converted 2026-09-11 as part
 * of closing the real gap the global ValidationPipe (main.ts) now defends
 * against project-wide. This is the exact body whose omitted
 * `resolutionNotes` field caused a real 500 this session before
 * SupportTicketService.resolve()'s own truthiness-check fix — the pipe now
 * rejects the same request with a clean 400 before it even reaches the
 * service, as defense in depth alongside that fix, not instead of it. */
export class ResolveSupportTicketBody {
  @IsString()
  @IsNotEmpty()
  resolutionNotes!: string;
}

/** The operator's manual subscription override — see AdminTenantService
 * .updateSubscription()'s own comment for why this exists alongside
 * BillingController's self-service selectTier(). `nextBillingDate` is
 * optional: omitting it leaves whatever the tenant already has (e.g. an
 * operator only correcting a stuck `status` shouldn't have to also
 * guess a billing date), an explicit ISO date sets a real one, and there
 * is no way to send `null` through a JSON body's optional field — see
 * the controller method's own handling of this. */
export class UpdateTenantSubscriptionBody {
  @IsIn(SUBSCRIPTION_TIERS)
  tier!: SubscriptionTier;

  @IsIn(SUBSCRIPTION_STATUSES)
  status!: SubscriptionStatus;

  @IsOptional()
  @IsISO8601()
  nextBillingDate?: string;
}

/** The tenant's own explicit request: "the administrator should be able
 * to set subscription tiers on their own however they want" — an
 * arbitrary per-tenant price override. `customPriceZar` omitted or sent
 * as `null` both clear the override back to the standard published
 * price — there's no third "leave as-is" case to distinguish here (unlike
 * UpdateTenantSubscriptionBody's own nextBillingDate), since this
 * endpoint's only two real intents are "set to this number" or "clear
 * it." */
export class SetTenantCustomPriceBody {
  @IsOptional()
  @IsNumber()
  @Min(0)
  customPriceZar?: number | null;
}

/** Migrated from the shared ADMIN_API_KEY secret to real per-admin auth
 * (Phase 1 of the admin-platform plan) — AdminApiKeyGuard's only
 * remaining job is bootstrapping the very first admin account (see
 * admin-auth.controller.ts's own top comment). */
@UseGuards(AdminAccessTokenGuard)
@Controller("admin")
export class AdminController {
  constructor(
    private readonly pilotSummaryService: PilotSummaryService,
    private readonly supportTicketAdminService: SupportTicketAdminService,
    private readonly adminTenantService: AdminTenantService,
    private readonly platformHealthService: PlatformHealthService
  ) {}

  @Get("pilot-summary")
  getPilotSummary() {
    return this.pilotSummaryService.getSummary();
  }

  /** Phase 3 of the admin-platform plan — real platform performance. */
  @Get("platform-health")
  getPlatformHealth() {
    return this.platformHealthService.getPlatformHealth();
  }

  /** Phase 2 of the admin-platform plan — real tenant management. */
  @Get("tenants")
  listTenants() {
    return this.adminTenantService.listTenants();
  }

  @Get("tenants/:tenantId")
  getTenantDetail(@Param("tenantId") tenantId: string) {
    return this.adminTenantService.getTenantDetail(tenantId);
  }

  @Post("tenants/:tenantId/suspend")
  async suspendTenant(@Param("tenantId") tenantId: string, @CurrentAdminUser() admin: VerifiedAdminAccessToken) {
    await this.adminTenantService.suspend(tenantId, admin.adminUserId);
    return { success: true };
  }

  @Post("tenants/:tenantId/reactivate")
  async reactivateTenant(@Param("tenantId") tenantId: string, @CurrentAdminUser() admin: VerifiedAdminAccessToken) {
    await this.adminTenantService.reactivate(tenantId, admin.adminUserId);
    return { success: true };
  }

  @Post("tenants/:tenantId/subscription")
  async updateTenantSubscription(
    @Param("tenantId") tenantId: string,
    @Body() body: UpdateTenantSubscriptionBody,
    @CurrentAdminUser() admin: VerifiedAdminAccessToken
  ) {
    await this.adminTenantService.updateSubscription(
      tenantId,
      body.tier,
      body.status,
      body.nextBillingDate ? new Date(body.nextBillingDate) : undefined,
      admin.adminUserId
    );
    return { success: true };
  }

  @Post("tenants/:tenantId/custom-price")
  async setTenantCustomPrice(@Param("tenantId") tenantId: string, @Body() body: SetTenantCustomPriceBody, @CurrentAdminUser() admin: VerifiedAdminAccessToken) {
    await this.adminTenantService.setCustomPrice(tenantId, body.customPriceZar ?? null, admin.adminUserId);
    return { success: true };
  }

  @Get("support-tickets")
  listSupportTickets() {
    return this.supportTicketAdminService.listAcrossTenants();
  }

  @Post("support-tickets/:tenantId/:ticketId/in-progress")
  markInProgress(@Param("tenantId") tenantId: string, @Param("ticketId") ticketId: string) {
    return this.supportTicketAdminService.markInProgress(tenantId, ticketId);
  }

  @Post("support-tickets/:tenantId/:ticketId/resolve")
  resolve(@Param("tenantId") tenantId: string, @Param("ticketId") ticketId: string, @Body() body: ResolveSupportTicketBody) {
    return this.supportTicketAdminService.resolve(tenantId, ticketId, body.resolutionNotes);
  }
}

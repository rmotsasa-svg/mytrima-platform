import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { IsIn } from "class-validator";
import { SubscriptionService, TIER_LABELS, TIER_PRICING_ZAR, PaidTier } from "./subscription.service";
import { TenantService, SubscriptionTier } from "../auth/tenant.service";
import { AccessTokenGuard } from "../auth/access-token.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import { VerifiedAccessToken } from "../auth/auth.service";
import { authorize } from "../auth/rbac";

const SUBSCRIPTION_TIERS: SubscriptionTier[] = ["free", "pro_plus", "growth_plan", "growth_partner"];

class SelectTierBody {
  @IsIn(SUBSCRIPTION_TIERS)
  tier!: SubscriptionTier;
}

/** Same env-var-with-a-localhost-default pattern as
 * TenantService.buildVerificationUrl()'s own APP_BASE_URL comment. The
 * redirect target is always this fixed, known SPA route, never a
 * client-supplied URL — unlike PaymentsController.createCheckout()'s own
 * returnUrl/cancelUrl (legitimately staff-supplied there, since staff is
 * generating a link for an external CUSTOMER's browser), this is the
 * tenant's own staff paying via their own session, so there's no reason
 * to accept an arbitrary redirect target for a real payment flow. */
function billingRedirectUrl(): string {
  const base = process.env.APP_BASE_URL ?? "http://localhost:5173";
  return `${base}/settings`;
}

/**
 * B2 of "ACTION PROPOSED ADDITIONS IN PRIORITY ORDER" — "use MoPay to
 * collect mytrima payments when tenants register on Mytrima." Owner-only
 * (tenant:manage_settings), same gate as the PayFast/MoPay merchant-id
 * endpoints in PaymentsController — a real financial commitment, not a
 * staff-level action.
 */
@UseGuards(AccessTokenGuard)
@Controller("billing")
export class BillingController {
  constructor(
    private readonly subscriptionService: SubscriptionService,
    private readonly tenantService: TenantService
  ) {}

  @Get(":tenantId/status")
  async getStatus(@CurrentUser() actor: VerifiedAccessToken, @Param("tenantId") tenantId: string) {
    authorize(actor, tenantId, "tenant:manage_settings");
    const tenant = await this.tenantService.getById(tenantId);
    const tier = tenant?.subscriptionTier ?? "free";
    return {
      tier,
      status: tenant?.subscriptionStatus ?? "active",
      nextBillingDate: tenant?.nextBillingDate ?? null,
      tierLabel: TIER_LABELS[tier],
      amountZar: tier === "free" ? 0 : TIER_PRICING_ZAR[tier as PaidTier],
    };
  }

  @Post(":tenantId/select-tier")
  async selectTier(@CurrentUser() actor: VerifiedAccessToken, @Param("tenantId") tenantId: string, @Body() body: SelectTierBody) {
    authorize(actor, tenantId, "tenant:manage_settings");
    return this.subscriptionService.selectTier(tenantId, body.tier, billingRedirectUrl());
  }

  /** A real, staff-triggerable "I've paid, check now" — same reasoning as
   * PaymentsController.verifyMopaySession()'s own comment: MoPay has no
   * server-push webhook, so this manual check (also run automatically
   * once a day by SubscriptionBillingCheckService) is a genuine
   * confirmation mechanism, not a formality. */
  @Post(":tenantId/confirm")
  async confirm(@CurrentUser() actor: VerifiedAccessToken, @Param("tenantId") tenantId: string) {
    authorize(actor, tenantId, "tenant:manage_settings");
    return this.subscriptionService.confirmPending(tenantId);
  }

  @Get(":tenantId/payments")
  async listPayments(@CurrentUser() actor: VerifiedAccessToken, @Param("tenantId") tenantId: string) {
    authorize(actor, tenantId, "tenant:manage_settings");
    return this.subscriptionService.listPaymentsForTenant(tenantId);
  }
}

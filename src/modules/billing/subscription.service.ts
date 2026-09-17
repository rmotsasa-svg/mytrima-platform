import { Inject, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { SUBSCRIPTION_PAYMENT_STORE, MOPAY_PLATFORM_API_KEY } from "./billing.tokens";
import { TenantService, SubscriptionTier, SubscriptionStatus } from "../auth/tenant.service";
import { MoPayService, MoPaySessionStatus } from "../integrations/payments/mopay.service";

/**
 * B2 of "ACTION PROPOSED ADDITIONS IN PRIORITY ORDER" — "use MoPay to
 * collect mytrima payments when tenants register on Mytrima, following
 * the prices on the landing page's Packages page, in ZAR, recurring."
 *
 * Architecturally the reverse of B1: B1 wired MoPay into a TENANT'S OWN
 * checkout for THEIR OWN customers (tenant.mopayApiKey, a per-tenant
 * account). This is Mytrima's OWN platform-level MoPay account
 * (MOPAY_PLATFORM_API_KEY) collecting a real subscription fee FROM a
 * tenant — the two never share a key.
 *
 * TIER_PRICING_ZAR below is the one source of truth for the real amounts
 * — mirrored from landing/src/pages/PackagesPage.tsx's own CORE_TIERS
 * array (Pro Plus R350, Growth Plan R420, Growth Partner R600, all
 * "/month"), not re-derived or guessed. If that page's real prices ever
 * change, this map is the other half of that same edit — same
 * "one source of truth, not two that could drift" discipline as
 * goal.service.ts's GoalBusinessArea comment.
 *
 * HONEST LIMITATION, not hidden: MoPay's own documented API (see
 * mopay.service.ts's own top comment) is a one-time hosted-checkout
 * flow — create a session, the customer pays it, you verify it. There is
 * no subscription/recurring-charge/stored-card endpoint in MoPay's real,
 * confirmed API. "Recurring" here is therefore built the same honest way
 * any real business collects recurring mobile-money dues without a
 * payment processor's own subscription feature: a new real MoPay session
 * is created for each billing period (SubscriptionBillingCheckService,
 * the scheduled daily job) and the tenant is emailed a real, working link
 * to pay it — never a fabricated "auto-charges silently" claim this
 * platform can't actually back up.
 */

export type PaidTier = Exclude<SubscriptionTier, "free">;

/** Mirrors landing/src/pages/PackagesPage.tsx's own CORE_TIERS — see this
 * file's own top comment. */
export const TIER_PRICING_ZAR: Record<PaidTier, number> = {
  pro_plus: 350,
  growth_plan: 420,
  growth_partner: 600,
};

export const TIER_LABELS: Record<SubscriptionTier, string> = {
  free: "Free",
  pro_plus: "Pro Plus",
  growth_plan: "Growth Plan",
  growth_partner: "Growth Partner",
};

export interface SubscriptionPayment {
  id: string;
  tenantId: string;
  tier: PaidTier;
  amountZar: number;
  mopaySessionId: string;
  mopayReference: string;
  status: "pending" | "paid" | "failed";
  createdAt: Date;
  paidAt?: Date;
}

export interface SubscriptionPaymentStore {
  save(payment: SubscriptionPayment): Promise<void>;
  findPendingForTenant(tenantId: string): Promise<SubscriptionPayment | null>;
  listForTenant(tenantId: string): Promise<SubscriptionPayment[]>;
}

export class MopayPlatformNotConfiguredError extends Error {
  constructor() {
    super("Mytrima's own MoPay platform account is not configured (MOPAY_PLATFORM_API_KEY unset) — subscription billing cannot run");
    this.name = "MopayPlatformNotConfiguredError";
  }
}

/** Thrown by selectTier() when a tenant already has a real payment
 * session in flight — the real reason for migration 0048's own
 * `tenant_subscription_payment_pending_idx` unique constraint: never let
 * a second concurrent MoPay session get created for the same tenant
 * while an earlier one might still be paid. The tenant's existing
 * pending session (its own checkoutUrl) is still valid to pay — the
 * caller should surface that, not create a duplicate. */
export class SubscriptionPaymentAlreadyPendingError extends Error {
  constructor(tenantId: string) {
    super(`Tenant "${tenantId}" already has a subscription payment awaiting confirmation`);
    this.name = "SubscriptionPaymentAlreadyPendingError";
  }
}

/**
 * Pure — a paid tenant's renewal is due once it's genuinely past its own
 * nextBillingDate, with no payment already in flight. `nextBillingDate`
 * being unset for a paid tier is a real, honest "never actually
 * completed a first payment yet" state (selectTier() only sets it once a
 * payment is confirmed) — never treated as "due," since there's nothing
 * to renew yet. Exported standalone so it's unit-testable against
 * hand-built fixtures, same discipline as isLeadStale()/isQuotationStale().
 */
export function isRenewalDue(tenant: { subscriptionTier: SubscriptionTier; subscriptionStatus: SubscriptionStatus; nextBillingDate?: Date }, now: Date): boolean {
  if (tenant.subscriptionTier === "free") return false;
  if (tenant.subscriptionStatus === "pending_payment") return false;
  if (!tenant.nextBillingDate) return false;
  return tenant.nextBillingDate.getTime() <= now.getTime();
}

/**
 * Pure — adds one calendar month, clamping to the real last day of the
 * target month rather than letting JS's own Date rollover silently drift
 * the billing date forward (the real bug this guards against: naively
 * calling `setUTCMonth(+1)` on Jan 31 lands on Mar 3, not Feb 28/29,
 * since February has no 31st — every month after that would then also be
 * off by a few days). Exported standalone, same "extract the real
 * decision into a testable function" discipline as
 * snapshot.service.ts's own computeDailyBudget().
 */
export function addOneMonth(date: Date): Date {
  const result = new Date(date);
  const day = result.getUTCDate();
  result.setUTCMonth(result.getUTCMonth() + 1);
  if (result.getUTCDate() !== day) result.setUTCDate(0);
  return result;
}

/** MoPay session statuses that mean "this won't complete" — a real,
 * terminal negative outcome, distinct from CREATED/PROCESSING (still
 * genuinely in flight). */
function isTerminalFailure(status: MoPaySessionStatus): boolean {
  return status === "FAILED" || status === "CANCELLED" || status === "EXPIRED";
}

@Injectable()
export class SubscriptionService {
  constructor(
    @Inject(SUBSCRIPTION_PAYMENT_STORE) private readonly store: SubscriptionPaymentStore,
    private readonly tenantService: TenantService,
    @Inject(MOPAY_PLATFORM_API_KEY) private readonly mopayPlatformApiKey: string
  ) {}

  /**
   * The tenant's own tier choice. "free" is always available and never
   * needs a payment — real behavior parity with the landing page's own
   * "no card required to start." A paid tier creates one real MoPay
   * session and returns its own real, live checkoutUrl for the caller to
   * send the tenant's browser to; the tenant's subscriptionStatus flips
   * to "pending_payment" immediately (not "active" — that only happens
   * once a real payment is actually confirmed, see confirmPending()).
   *
   * DISCLOSED SIMPLIFICATION: switching tiers mid-cycle (e.g. Pro Plus ->
   * Growth Partner before the current month is up) always starts a fresh
   * billing cycle rather than prorating the switch — no product spec
   * asks for proration yet, same "don't build a feature nothing has
   * asked for" discipline as rbac.ts's own comment.
   */
  async selectTier(tenantId: string, tier: SubscriptionTier, redirectUrl: string): Promise<{ tier: SubscriptionTier; checkoutUrl?: string }> {
    if (tier === "free") {
      await this.tenantService.setSubscription(tenantId, "free", "active", null);
      return { tier: "free" };
    }

    const existingPending = await this.store.findPendingForTenant(tenantId);
    if (existingPending) throw new SubscriptionPaymentAlreadyPendingError(tenantId);

    const session = await this.createCheckoutSession(tenantId, tier, redirectUrl);
    await this.tenantService.setSubscription(tenantId, tier, "pending_payment", null);
    return { tier, checkoutUrl: session.checkoutUrl };
  }

  /**
   * A real, non-fabricated status check against MoPay's own session-detail
   * endpoint — same "don't trust redirect params alone" discipline as
   * PaymentsController.verifyMopaySession()'s own comment. Called both by
   * a staff member manually confirming ("I've paid, check now") and by
   * SubscriptionBillingCheckService's daily poll — one real code path,
   * not two that could diverge.
   */
  async confirmPending(tenantId: string, now: Date = new Date()): Promise<{ status: SubscriptionStatus }> {
    const pending = await this.store.findPendingForTenant(tenantId);
    if (!pending) {
      const tenant = await this.tenantService.getById(tenantId);
      return { status: tenant?.subscriptionStatus ?? "active" };
    }

    if (!this.mopayPlatformApiKey) throw new MopayPlatformNotConfiguredError();
    const mopay = new MoPayService(this.mopayPlatformApiKey);
    const session = await mopay.getSession(pending.mopaySessionId);

    if (session.status === "COMPLETED") {
      await this.store.save({ ...pending, status: "paid", paidAt: now });
      await this.tenantService.setSubscription(tenantId, pending.tier, "active", addOneMonth(now));
      return { status: "active" };
    }

    if (isTerminalFailure(session.status)) {
      await this.store.save({ ...pending, status: "failed" });
      await this.tenantService.setSubscription(tenantId, pending.tier, "past_due", null);
      return { status: "past_due" };
    }

    return { status: "pending_payment" };
  }

  /**
   * The renewal half of "must be a recurring fee" — called once per
   * tenant per day by SubscriptionBillingCheckService. Real work only
   * happens when isRenewalDue() says so; every other call is a genuine,
   * cheap no-op. Creates a fresh MoPay session for the SAME tier the
   * tenant is already on (a renewal, not a tier change — selectTier() is
   * the only way to actually change tiers) and emails the tenant a real,
   * working payment link.
   */
  async chargeRenewalIfDue(
    tenantId: string,
    tenant: { subscriptionTier: SubscriptionTier; subscriptionStatus: SubscriptionStatus; nextBillingDate?: Date },
    redirectUrl: string,
    now: Date = new Date()
  ): Promise<{ charged: boolean; checkoutUrl?: string }> {
    if (!isRenewalDue(tenant, now)) return { charged: false };
    const tier = tenant.subscriptionTier as PaidTier;
    const session = await this.createCheckoutSession(tenantId, tier, redirectUrl);
    await this.tenantService.setSubscription(tenantId, tier, "pending_payment", tenant.nextBillingDate ?? null);
    return { charged: true, checkoutUrl: session.checkoutUrl };
  }

  async listPaymentsForTenant(tenantId: string): Promise<SubscriptionPayment[]> {
    return this.store.listForTenant(tenantId);
  }

  private async createCheckoutSession(tenantId: string, tier: PaidTier, redirectUrl: string): Promise<{ checkoutUrl: string }> {
    if (!this.mopayPlatformApiKey) throw new MopayPlatformNotConfiguredError();
    const mopay = new MoPayService(this.mopayPlatformApiKey);
    const amount = TIER_PRICING_ZAR[tier];
    // A real, purely-alphanumeric reference — MoPay's own documented
    // constraint (see mopay.service.ts's REFERENCE_PATTERN) — derived
    // from a fresh uuid with its dashes stripped, not the tenantId
    // itself (which is a real uuid and would fail that same pattern).
    const reference = randomUUID().replace(/-/g, "");
    const session = await mopay.createPaymentSession({
      amount: amount.toFixed(2),
      reference,
      redirectUrl,
      description: `Mytrima ${TIER_LABELS[tier]} subscription`,
    });
    await this.store.save({
      id: randomUUID(),
      tenantId,
      tier,
      amountZar: amount,
      mopaySessionId: session.sessionId,
      mopayReference: session.reference,
      status: "pending",
      createdAt: new Date(),
    });
    return { checkoutUrl: session.paymentUrl };
  }
}

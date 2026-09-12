import { Inject, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { MoPayService, MoPaySessionDetails } from "../integrations/payments/mopay.service";
import { PACKAGES, findPackage } from "./packages";
import { SUBSCRIPTION_STORE, SUBSCRIPTION_PAYMENT_STORE, MOPAY_API_KEY } from "./billing.tokens";

/**
 * Collects what Mytrima charges ITS OWN TENANTS for using the platform —
 * a completely separate concern from PaymentsModule/PayFastService, which
 * is the tenant's OWN customers paying the tenant (merchant-of-record,
 * real-time Split Payments). This module never touches PayFast at all.
 *
 * Real gap closed 2026-09-12, the tenant's own explicit direction
 * following the SPA feature-spec assessment's "Subscription/Bills"
 * finding: collect these payments via MoPay
 * (../integrations/payments/mopay.service.ts) — a fully live-verified
 * client (real sandbox create->pay->verify flow already proven, fees
 * confirmed by the vendor) that had never been wired to any real business
 * flow before this.
 *
 * Deliberately does NOT gate any feature or access on subscription status
 * — see migration 0027's own top comment for why. This is record-keeping
 * (what package is a tenant on, what have they paid) plus a real checkout,
 * not an access-control system nobody has asked for yet.
 */
export interface TenantSubscription {
  tenantId: string;
  package: string;
  status: "active" | "inactive";
  currentPeriodStart?: Date;
  currentPeriodEnd?: Date;
  updatedAt: Date;
}

export type SubscriptionPaymentStatus = "created" | "completed" | "failed" | "cancelled";

export interface SubscriptionPayment {
  id: string;
  tenantId: string;
  package: string;
  amount: number;
  mopaySessionId: string;
  mopayReference: string;
  status: SubscriptionPaymentStatus;
  createdAt: Date;
  completedAt?: Date;
}

export interface SubscriptionStore {
  find(tenantId: string): Promise<TenantSubscription | null>;
  save(subscription: TenantSubscription): Promise<void>;
}

export interface SubscriptionPaymentStore {
  save(payment: SubscriptionPayment): Promise<void>;
  findById(tenantId: string, id: string): Promise<SubscriptionPayment | null>;
  findByMoPaySessionId(tenantId: string, mopaySessionId: string): Promise<SubscriptionPayment | null>;
  listForTenant(tenantId: string): Promise<SubscriptionPayment[]>;
}

export class UnknownPackageError extends Error {
  constructor(packageName: string) {
    super(`"${packageName}" is not a real Mytrima package`);
    this.name = "UnknownPackageError";
  }
}

export class PackageNotSelfServeError extends Error {
  constructor(packageName: string) {
    super(`"${packageName}" has no fixed price — contact Mytrima directly rather than checking out`);
    this.name = "PackageNotSelfServeError";
  }
}

export class MoPayNotConfiguredError extends Error {
  constructor() {
    super("MOPAY_API_KEY is not configured — billing checkout cannot run until a real MoPay API key is set");
    this.name = "MoPayNotConfiguredError";
  }
}

export class SubscriptionPaymentNotFoundError extends Error {
  constructor(id: string) {
    super(`No subscription payment found with id "${id}"`);
    this.name = "SubscriptionPaymentNotFoundError";
  }
}

const SUBSCRIPTION_PERIOD_DAYS = 30; // "per month" — matches the Packages page's own billing period

/** Reference must be alphanumeric only — MoPay's own documented
 * constraint (mopay.service.ts's own REFERENCE_PATTERN comment). Built
 * from the tenant id (hyphens stripped) plus a real timestamp, so two
 * checkouts for the same tenant never collide on the same reference. */
function buildMoPayReference(tenantId: string): string {
  return `${tenantId.replace(/-/g, "")}${Date.now()}`;
}

@Injectable()
export class BillingService {
  constructor(
    @Inject(SUBSCRIPTION_STORE) private readonly subscriptions: SubscriptionStore,
    @Inject(SUBSCRIPTION_PAYMENT_STORE) private readonly payments: SubscriptionPaymentStore,
    @Inject(MOPAY_API_KEY) private readonly mopayApiKey: string
  ) {}

  /** A tenant with no subscription row yet is really on "Start Free" —
   * the real default state every self-serve signup lands in, not a
   * fabricated placeholder. */
  async getCurrentSubscription(tenantId: string): Promise<TenantSubscription> {
    const existing = await this.subscriptions.find(tenantId);
    if (existing) return existing;
    return { tenantId, package: "Start Free", status: "active", updatedAt: new Date() };
  }

  async listPayments(tenantId: string): Promise<SubscriptionPayment[]> {
    return this.payments.listForTenant(tenantId);
  }

  /** Step 1 of the real MoPay flow (mopay.service.ts's own documented
   * create -> pay -> verify): validates the package is real and
   * self-serve, creates a real MoPay session, records the attempt (status
   * "created" — regardless of whether the tenant ever completes payment,
   * same "record every attempt" reasoning as PayfastItnLogService), and
   * returns the real paymentUrl to redirect the caller's browser to. */
  async startCheckout(tenantId: string, packageName: string, redirectUrl: string): Promise<{ paymentUrl: string; paymentId: string }> {
    const pkg = findPackage(packageName);
    if (!pkg) throw new UnknownPackageError(packageName);
    if (pkg.priceLSL === null) throw new PackageNotSelfServeError(packageName);
    if (!this.mopayApiKey) throw new MoPayNotConfiguredError();

    const mopay = new MoPayService(this.mopayApiKey);
    const reference = buildMoPayReference(tenantId);
    const session = await mopay.createPaymentSession({
      amount: pkg.priceLSL.toFixed(2),
      reference,
      redirectUrl,
      description: `Mytrima — ${pkg.name} subscription`,
    });

    const paymentId = randomUUID();
    await this.payments.save({
      id: paymentId,
      tenantId,
      package: pkg.name,
      amount: pkg.priceLSL,
      mopaySessionId: session.sessionId,
      mopayReference: session.reference,
      status: "created",
      createdAt: new Date(),
    });

    return { paymentUrl: session.paymentUrl, paymentId };
  }

  /** Step 3 of the real MoPay flow: called after the tenant is redirected
   * back. Deliberately re-fetches the session from MoPay's own API rather
   * than trusting redirect query params — mopay.service.ts's own
   * getSession() doc comment quotes MoPay's docs warning those can be
   * tampered with. On a real success, this is the one place a tenant's
   * package actually changes — not startCheckout(), which only ever
   * records an attempt. */
  async verifyPayment(tenantId: string, paymentId: string): Promise<{ payment: SubscriptionPayment; subscription: TenantSubscription }> {
    const payment = await this.payments.findById(tenantId, paymentId);
    if (!payment) throw new SubscriptionPaymentNotFoundError(paymentId);
    if (!this.mopayApiKey) throw new MoPayNotConfiguredError();

    // Already resolved by an earlier call — idempotent, same reasoning as
    // AuthService.verifyEmailAddress(): a tenant refreshing the
    // post-payment page twice shouldn't re-verify against MoPay a second
    // time or risk double-applying the subscription change.
    if (payment.status !== "created") {
      const subscription = await this.getCurrentSubscription(tenantId);
      return { payment, subscription };
    }

    const mopay = new MoPayService(this.mopayApiKey);
    const session: MoPaySessionDetails = await mopay.getSession(payment.mopaySessionId);

    const succeeded = session.status === "COMPLETED" && session.transactionStatus === "success";
    const updatedPayment: SubscriptionPayment = {
      ...payment,
      status: succeeded ? "completed" : session.status === "CANCELLED" ? "cancelled" : "failed",
      completedAt: succeeded ? new Date() : undefined,
    };
    await this.payments.save(updatedPayment);

    if (!succeeded) {
      const subscription = await this.getCurrentSubscription(tenantId);
      return { payment: updatedPayment, subscription };
    }

    const now = new Date();
    const periodEnd = new Date(now.getTime() + SUBSCRIPTION_PERIOD_DAYS * 24 * 60 * 60 * 1000);
    const subscription: TenantSubscription = {
      tenantId,
      package: payment.package,
      status: "active",
      currentPeriodStart: now,
      currentPeriodEnd: periodEnd,
      updatedAt: now,
    };
    await this.subscriptions.save(subscription);

    return { payment: updatedPayment, subscription };
  }
}

export { PACKAGES };

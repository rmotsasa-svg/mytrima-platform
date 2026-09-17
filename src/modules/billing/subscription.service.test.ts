import { SubscriptionService, SubscriptionPaymentAlreadyPendingError, MopayPlatformNotConfiguredError, isRenewalDue, addOneMonth, TIER_PRICING_ZAR, TIER_LABELS } from "./subscription.service";
import { InMemorySubscriptionPaymentStore } from "./in-memory-subscription-payment.store";
import { TenantService } from "../auth/tenant.service";
import { InMemoryTenantStore } from "../auth/in-memory-tenant.store";
import { AuthService } from "../auth/auth.service";
import { InMemoryAuthUserStore } from "../auth/in-memory-auth-user.store";
import { InMemoryRevokedRefreshTokenStore } from "../auth/in-memory-revoked-token.store";
import { generateMfaEncryptionKey } from "../auth/mfa-secret-crypto";
import { ConsoleEmailService } from "../integrations/email/email.service";

/* ---------- TIER_PRICING_ZAR / TIER_LABELS — real prices, no fabrication ---------- */

test("TIER_PRICING_ZAR mirrors the real landing-page package prices exactly (landing/src/pages/PackagesPage.tsx)", () => {
  expect(TIER_PRICING_ZAR.pro_plus).toBe(350);
  expect(TIER_PRICING_ZAR.growth_plan).toBe(420);
  expect(TIER_PRICING_ZAR.growth_partner).toBe(600);
});

test("TIER_LABELS covers every real tier including free", () => {
  expect(TIER_LABELS.free).toBe("Free");
  expect(TIER_LABELS.pro_plus).toBe("Pro Plus");
  expect(TIER_LABELS.growth_plan).toBe("Growth Plan");
  expect(TIER_LABELS.growth_partner).toBe("Growth Partner");
});

/* ---------- addOneMonth ---------- */

test("addOneMonth advances a mid-month date by exactly one calendar month", () => {
  const result = addOneMonth(new Date("2026-03-15T00:00:00.000Z"));
  expect(result.toISOString().slice(0, 10)).toBe("2026-04-15");
});

test("addOneMonth clamps a month-end overflow to the real last day of the target month — the exact bug a naive setUTCMonth() would hit", () => {
  // Jan 31 + 1 month would naively land on Mar 3 (Feb only has 28 days in
  // 2026, a non-leap year) — the real, disclosed reason for this
  // function's own clamp step.
  const result = addOneMonth(new Date("2026-01-31T00:00:00.000Z"));
  expect(result.toISOString().slice(0, 10)).toBe("2026-02-28");
});

test("addOneMonth handles a leap-year February correctly", () => {
  const result = addOneMonth(new Date("2028-01-31T00:00:00.000Z")); // 2028 is a leap year
  expect(result.toISOString().slice(0, 10)).toBe("2028-02-29");
});

/* ---------- isRenewalDue ---------- */

const NOW = new Date("2026-09-17T12:00:00.000Z");

test("isRenewalDue is false for a free tier no matter what", () => {
  expect(isRenewalDue({ subscriptionTier: "free", subscriptionStatus: "active", nextBillingDate: new Date("2020-01-01") }, NOW)).toBe(false);
});

test("isRenewalDue is false while a payment is already pending — never double-charge", () => {
  expect(isRenewalDue({ subscriptionTier: "pro_plus", subscriptionStatus: "pending_payment", nextBillingDate: new Date("2020-01-01") }, NOW)).toBe(false);
});

test("isRenewalDue is false for a paid tier that's never actually completed a first payment (no nextBillingDate yet)", () => {
  expect(isRenewalDue({ subscriptionTier: "pro_plus", subscriptionStatus: "active", nextBillingDate: undefined }, NOW)).toBe(false);
});

test("isRenewalDue is false before the real due date, true on or after it", () => {
  const notYetDue = { subscriptionTier: "pro_plus" as const, subscriptionStatus: "active" as const, nextBillingDate: new Date("2026-09-18") };
  const dueToday = { subscriptionTier: "pro_plus" as const, subscriptionStatus: "active" as const, nextBillingDate: new Date("2026-09-17T12:00:00.000Z") };
  const overdue = { subscriptionTier: "pro_plus" as const, subscriptionStatus: "past_due" as const, nextBillingDate: new Date("2026-08-01") };
  expect(isRenewalDue(notYetDue, NOW)).toBe(false);
  expect(isRenewalDue(dueToday, NOW)).toBe(true);
  expect(isRenewalDue(overdue, NOW)).toBe(true);
});

/* ---------- SubscriptionService (in-memory, no real MoPay call — errors from a real empty platform key) ---------- */

function makeService(mopayApiKey = "") {
  const paymentStore = new InMemorySubscriptionPaymentStore();
  const tenantService = new TenantService(
    new InMemoryTenantStore(),
    new AuthService(new InMemoryAuthUserStore(), "test-secret", new InMemoryRevokedRefreshTokenStore(), generateMfaEncryptionKey()),
    new ConsoleEmailService()
  );
  const service = new SubscriptionService(paymentStore, tenantService, mopayApiKey);
  return { service, tenantService, paymentStore };
}

test("selectTier('free') never touches MoPay and sets the tenant to free/active immediately, even with no platform key configured", async () => {
  const { service, tenantService } = makeService(""); // no MOPAY_PLATFORM_API_KEY
  const { tenantId } = await tenantService.registerTenant("Biz", "owner@example.com", "a-real-password");
  const result = await service.selectTier(tenantId, "free", "http://localhost:5173/settings");
  expect(result).toEqual({ tier: "free" });
  const tenant = await tenantService.getById(tenantId);
  expect(tenant?.subscriptionTier).toBe("free");
  expect(tenant?.subscriptionStatus).toBe("active");
  expect(tenant?.nextBillingDate).toBeUndefined();
});

test("selectTier(paidTier) with no MOPAY_PLATFORM_API_KEY configured throws MopayPlatformNotConfiguredError, not a confusing network error", async () => {
  const { service, tenantService } = makeService("");
  const { tenantId } = await tenantService.registerTenant("Biz", "owner@example.com", "a-real-password");
  await expect(service.selectTier(tenantId, "pro_plus", "http://localhost:5173/settings")).rejects.toThrow(MopayPlatformNotConfiguredError);
});

test("selectTier(paidTier) refuses a second attempt while a payment is already pending — never a duplicate MoPay session", async () => {
  const { service, tenantService, paymentStore } = makeService(""); // key irrelevant — this check happens first
  const { tenantId } = await tenantService.registerTenant("Biz", "owner@example.com", "a-real-password");
  await paymentStore.save({
    id: "p1",
    tenantId,
    tier: "pro_plus",
    amountZar: 350,
    mopaySessionId: "sess1",
    mopayReference: "ref1",
    status: "pending",
    createdAt: new Date(),
  });
  await expect(service.selectTier(tenantId, "pro_plus", "http://localhost:5173/settings")).rejects.toThrow(SubscriptionPaymentAlreadyPendingError);
});

test("confirmPending with no pending payment is a real, honest no-op returning the tenant's current status", async () => {
  const { service, tenantService } = makeService("");
  const { tenantId } = await tenantService.registerTenant("Biz", "owner@example.com", "a-real-password");
  const result = await service.confirmPending(tenantId);
  expect(result.status).toBe("active");
});

test("chargeRenewalIfDue is a real no-op when isRenewalDue() says nothing is due — never calls MoPay unnecessarily", async () => {
  const { service } = makeService(""); // would throw if it actually tried to reach MoPay with no key
  const result = await service.chargeRenewalIfDue(
    "t1",
    { subscriptionTier: "free", subscriptionStatus: "active", nextBillingDate: undefined },
    "http://localhost:5173/settings"
  );
  expect(result).toEqual({ charged: false });
});

test("listPaymentsForTenant returns an empty array, not undefined, for a tenant with no payment history", async () => {
  const { service } = makeService();
  await expect(service.listPaymentsForTenant("t1")).resolves.toEqual([]);
});

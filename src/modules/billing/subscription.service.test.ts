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
    new AuthService(new InMemoryAuthUserStore(), "test-secret", new InMemoryRevokedRefreshTokenStore(), generateMfaEncryptionKey(), new InMemoryTenantStore()),
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

/* ---------- customPriceZar — the tenant's own explicit request: "the
 * administrator should be able to set subscription tiers on their own
 * however they want" (an admin-only per-tenant price override, migration
 * 0050) — real end-to-end proof it actually changes what gets charged,
 * not just that the field round-trips. Mocks `fetch` the same way
 * mopay.service.test.ts's own suite does, for a deterministic,
 * network-free real checkout-session creation. ---------- */

function mockFetchResolvedOnce(status: number, body: unknown): jest.Mock {
  const mock = jest.fn().mockResolvedValue({ status, json: async () => body });
  (globalThis as unknown as { fetch: typeof fetch }).fetch = mock as unknown as typeof fetch;
  return mock;
}

test("selectTier charges the tenant's real customPriceZar override instead of the standard TIER_PRICING_ZAR amount", async () => {
  const { service, tenantService } = makeService("sandbox-key-123");
  const { tenantId } = await tenantService.registerTenant("Biz", "owner@example.com", "a-real-password");
  await tenantService.setCustomPrice(tenantId, 275);

  const fetchMock = mockFetchResolvedOnce(200, {
    success: true,
    sessionId: "MOP_custom_1",
    paymentUrl: "https://mopay.co.ls/pay/MOP_custom_1",
    reference: "REF1",
    amount: "275.00",
  });

  await service.selectTier(tenantId, "growth_plan", "http://localhost:5173/settings");

  const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
  expect(JSON.parse(options.body as string)).toMatchObject({ amount: "275.00" });

  const payments = await service.listPaymentsForTenant(tenantId);
  expect(payments).toHaveLength(1);
  expect(payments[0].amountZar).toBe(275); // not TIER_PRICING_ZAR.growth_plan (420)
});

test("selectTier charges the standard TIER_PRICING_ZAR amount when no custom price override is set", async () => {
  const { service, tenantService } = makeService("sandbox-key-123");
  const { tenantId } = await tenantService.registerTenant("Biz", "owner@example.com", "a-real-password");

  mockFetchResolvedOnce(200, {
    success: true,
    sessionId: "MOP_standard_1",
    paymentUrl: "https://mopay.co.ls/pay/MOP_standard_1",
    reference: "REF2",
    amount: "420.00",
  });

  await service.selectTier(tenantId, "growth_plan", "http://localhost:5173/settings");

  const payments = await service.listPaymentsForTenant(tenantId);
  expect(payments[0].amountZar).toBe(420);
});

test("chargeRenewalIfDue charges the real customPriceZar passed through, not the standard tier amount", async () => {
  const { service, tenantService } = makeService("sandbox-key-123");
  const { tenantId } = await tenantService.registerTenant("Biz", "owner@example.com", "a-real-password");

  mockFetchResolvedOnce(200, {
    success: true,
    sessionId: "MOP_renewal_1",
    paymentUrl: "https://mopay.co.ls/pay/MOP_renewal_1",
    reference: "REF3",
    amount: "199.00",
  });

  const result = await service.chargeRenewalIfDue(
    tenantId,
    { subscriptionTier: "pro_plus", subscriptionStatus: "active", nextBillingDate: new Date("2020-01-01"), customPriceZar: 199 },
    "http://localhost:5173/settings"
  );

  expect(result.charged).toBe(true);
  const payments = await service.listPaymentsForTenant(tenantId);
  expect(payments[0].amountZar).toBe(199);
});

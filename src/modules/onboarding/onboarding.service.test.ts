import { computeOnboardingStatus } from "./onboarding.service";

function allTrue() {
  return {
    hasBusinessProfile: true,
    hasGrowthAudit: true,
    hasNotificationPhone: true,
    hasSocialConnection: true,
    hasPayfastMerchantId: true,
    hasFirstCustomer: true,
  };
}

test("a brand-new tenant with none of the signals is 0% complete, every step incomplete", () => {
  const status = computeOnboardingStatus({
    hasBusinessProfile: false,
    hasGrowthAudit: false,
    hasNotificationPhone: false,
    hasSocialConnection: false,
    hasPayfastMerchantId: false,
    hasFirstCustomer: false,
  });
  expect(status.completedCount).toBe(0);
  expect(status.totalCount).toBe(6);
  expect(status.percentComplete).toBe(0);
  expect(status.steps.every((s) => !s.completed)).toBe(true);
});

test("a fully set-up tenant is 100% complete, every step marked done", () => {
  const status = computeOnboardingStatus(allTrue());
  expect(status.completedCount).toBe(6);
  expect(status.percentComplete).toBe(100);
  expect(status.steps.every((s) => s.completed)).toBe(true);
});

test("a partially set-up tenant reports exactly which steps are done and which aren't", () => {
  const status = computeOnboardingStatus({ ...allTrue(), hasSocialConnection: false, hasPayfastMerchantId: false });
  expect(status.completedCount).toBe(4);
  expect(status.percentComplete).toBe(67);
  const byKey = Object.fromEntries(status.steps.map((s) => [s.key, s.completed]));
  expect(byKey.social_connected).toBe(false);
  expect(byKey.payfast_merchant_id).toBe(false);
  expect(byKey.business_profile).toBe(true);
  expect(byKey.growth_audit).toBe(true);
  expect(byKey.notification_phone).toBe(true);
  expect(byKey.first_customer).toBe(true);
});

test("business_profile is its own independent signal from the other five", () => {
  const status = computeOnboardingStatus({ ...allTrue(), hasBusinessProfile: false });
  expect(status.completedCount).toBe(5);
  const byKey = Object.fromEntries(status.steps.map((s) => [s.key, s.completed]));
  expect(byKey.business_profile).toBe(false);
});

test("every step has a distinct, stable key and a human-readable label", () => {
  const status = computeOnboardingStatus(allTrue());
  const keys = status.steps.map((s) => s.key);
  expect(new Set(keys).size).toBe(keys.length); // no duplicate keys
  expect(status.steps.every((s) => s.label.length > 0)).toBe(true);
});

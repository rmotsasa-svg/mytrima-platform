import { randomUUID } from "node:crypto";
import { OnboardingService } from "./onboarding.service";
import { TenantService } from "../auth/tenant.service";
import { InMemoryTenantStore } from "../auth/in-memory-tenant.store";
import { AuthService } from "../auth/auth.service";
import { InMemoryAuthUserStore } from "../auth/in-memory-auth-user.store";
import { InMemoryRevokedRefreshTokenStore } from "../auth/in-memory-revoked-token.store";
import { generateMfaEncryptionKey } from "../auth/mfa-secret-crypto";
import { GrowthAuditService } from "../growth-audit/growth-audit.service";
import { InMemoryGrowthAuditResponseStore } from "../growth-audit/in-memory-growth-audit-response.store";
import { SocialConnectionService } from "../social-publishing/social-connection.service";
import { InMemorySocialConnectionStore } from "../social-publishing/in-memory-social-connection.store";
import { CustomerService } from "../customers/customer.service";
import { InMemoryCustomerStore } from "../customers/in-memory-customer.store";
import { RatingService } from "../reputation/rating.service";
import { InMemoryRatingStore } from "../reputation/in-memory-rating.store";
import { ConsentService } from "../compliance/consent.service";
import { InMemoryConsentStore } from "../compliance/in-memory-consent.store";

/**
 * Real integration test — every service here is a genuine instance (only
 * the underlying stores are in-memory), proving the actual cross-module
 * wiring OnboardingService.getStatus() depends on, not just the pure
 * computeOnboardingStatus() logic already covered in onboarding.service.test.ts.
 */
function makeOnboardingService() {
  const tenantService = new TenantService(
    new InMemoryTenantStore(),
    new AuthService(new InMemoryAuthUserStore(), "test-secret", new InMemoryRevokedRefreshTokenStore(), generateMfaEncryptionKey())
  );
  const growthAuditService = new GrowthAuditService(new InMemoryGrowthAuditResponseStore());
  const socialConnectionService = new SocialConnectionService(new InMemorySocialConnectionStore());
  const ratingService = new RatingService(new InMemoryRatingStore());
  const consentService = new ConsentService(new InMemoryConsentStore());
  const customerService = new CustomerService(new InMemoryCustomerStore(), ratingService, consentService);

  const onboardingService = new OnboardingService(tenantService, growthAuditService, socialConnectionService, customerService);
  return { onboardingService, tenantService, growthAuditService, socialConnectionService, customerService };
}

test("a freshly registered tenant with no activity is 0% onboarded", async () => {
  const { onboardingService, tenantService } = makeOnboardingService();
  const { tenantId } = await tenantService.registerTenant("Fresh Biz", "owner@example.com", "a-real-password");

  const status = await onboardingService.getStatus(tenantId);
  expect(status.percentComplete).toBe(0);
});

test("getStatus reflects real signals as they're genuinely completed, one at a time", async () => {
  const { onboardingService, tenantService, growthAuditService, socialConnectionService, customerService } = makeOnboardingService();
  const { tenantId } = await tenantService.registerTenant("Growing Biz", "owner@example.com", "a-real-password");

  await tenantService.setNotificationPhone(tenantId, "+26612345678");
  let status = await onboardingService.getStatus(tenantId);
  expect(status.steps.find((s) => s.key === "notification_phone")?.completed).toBe(true);
  expect(status.completedCount).toBe(1);

  await growthAuditService.submit(
    tenantId,
    Object.fromEntries(Array.from({ length: 40 }, (_, i) => [i + 1, 2])),
    randomUUID()
  );
  status = await onboardingService.getStatus(tenantId);
  expect(status.steps.find((s) => s.key === "growth_audit")?.completed).toBe(true);
  expect(status.completedCount).toBe(2);

  await socialConnectionService.save({
    id: randomUUID(),
    tenantId,
    provider: "facebook",
    pageId: "123",
    pageName: "Test Page",
    pageAccessToken: "token",
    instagramAccountId: null,
    connectedAt: new Date(),
  });
  status = await onboardingService.getStatus(tenantId);
  expect(status.steps.find((s) => s.key === "social_connected")?.completed).toBe(true);
  expect(status.completedCount).toBe(3);

  await tenantService.setPayfastMerchantId(tenantId, "10000100");
  status = await onboardingService.getStatus(tenantId);
  expect(status.steps.find((s) => s.key === "payfast_merchant_id")?.completed).toBe(true);
  expect(status.completedCount).toBe(4);

  await customerService.create(tenantId, randomUUID(), "First Customer");
  status = await onboardingService.getStatus(tenantId);
  expect(status.steps.find((s) => s.key === "first_customer")?.completed).toBe(true);
  expect(status.completedCount).toBe(5);
  expect(status.percentComplete).toBe(100);
});

test("getStatus is tenant-scoped — one tenant's progress never leaks into another's", async () => {
  const { onboardingService, tenantService, customerService } = makeOnboardingService();
  const { tenantId: tenantA } = await tenantService.registerTenant("Tenant A", "owner-a@example.com", "a-real-password");
  const { tenantId: tenantB } = await tenantService.registerTenant("Tenant B", "owner-b@example.com", "a-real-password");

  await customerService.create(tenantA, randomUUID(), "A's Customer");

  const statusA = await onboardingService.getStatus(tenantA);
  const statusB = await onboardingService.getStatus(tenantB);
  expect(statusA.steps.find((s) => s.key === "first_customer")?.completed).toBe(true);
  expect(statusB.steps.find((s) => s.key === "first_customer")?.completed).toBe(false);
});

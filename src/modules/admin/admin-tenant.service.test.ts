import { randomUUID } from "node:crypto";
import { AdminTenantService, AdminTenantNotFoundError } from "./admin-tenant.service";
import { PilotSummaryService } from "./pilot-summary.service";
import { SupportTicketAdminService } from "./support-ticket-admin.service";
import { GrowthAuditService } from "../growth-audit/growth-audit.service";
import { InMemoryGrowthAuditResponseStore } from "../growth-audit/in-memory-growth-audit-response.store";
import { NpsService } from "../growth-audit/nps.service";
import { InMemoryNpsResponseStore } from "../growth-audit/in-memory-nps-response.store";
import { OnboardingService } from "../onboarding/onboarding.service";
import { SupportTicketService } from "../support/support-ticket.service";
import { InMemorySupportTicketStore } from "../support/in-memory-support-ticket.store";
import { TenantService } from "../auth/tenant.service";
import { InMemoryTenantStore } from "../auth/in-memory-tenant.store";
import { AuthService } from "../auth/auth.service";
import { InMemoryAuthUserStore } from "../auth/in-memory-auth-user.store";
import { InMemoryRevokedRefreshTokenStore } from "../auth/in-memory-revoked-token.store";
import { generateMfaEncryptionKey } from "../auth/mfa-secret-crypto";
import { SocialConnectionService } from "../social-publishing/social-connection.service";
import { InMemorySocialConnectionStore } from "../social-publishing/in-memory-social-connection.store";
import { CustomerService } from "../customers/customer.service";
import { InMemoryCustomerStore } from "../customers/in-memory-customer.store";
import { RatingService } from "../reputation/rating.service";
import { InMemoryRatingStore } from "../reputation/in-memory-rating.store";
import { ConsentService } from "../compliance/consent.service";
import { InMemoryConsentStore } from "../compliance/in-memory-consent.store";
import { GoalService } from "../goals/goal.service";
import { InMemoryGoalStore } from "../goals/in-memory-goal.store";
import { ConsoleEmailService } from "../integrations/email/email.service";
import { SubscriptionService } from "../billing/subscription.service";
import { InMemorySubscriptionPaymentStore } from "../billing/in-memory-subscription-payment.store";

/**
 * Hand-constructed, no-TestingModule, matching every other admin/*
 * .service.test.ts in this codebase. PilotSummaryService/
 * SupportTicketAdminService are both given a `null` pool (same as their
 * own tests) — no in-memory tenant registry exists to enumerate, so
 * listTenants() genuinely returns [] here; that cross-tenant enumeration
 * is only exercised for real against a live Postgres instance (see
 * pilot-summary.service.test.ts). getTenantDetail()/suspend()/
 * reactivate() don't depend on that enumeration at all — they look a
 * single real tenant up directly via TenantService.getById(), which the
 * in-memory store does support, so those are exercised for real here.
 */
function makeServices() {
  const tenantStore = new InMemoryTenantStore();
  const authUserStore = new InMemoryAuthUserStore();
  const authService = new AuthService(authUserStore, "admin-tenant-test-secret", new InMemoryRevokedRefreshTokenStore(), generateMfaEncryptionKey(), tenantStore);
  const tenantService = new TenantService(tenantStore, authService, new ConsoleEmailService());

  const growthAuditService = new GrowthAuditService(new InMemoryGrowthAuditResponseStore());
  const npsService = new NpsService(new InMemoryNpsResponseStore());
  const socialConnectionService = new SocialConnectionService(new InMemorySocialConnectionStore());
  const ratingService = new RatingService(new InMemoryRatingStore());
  const consentService = new ConsentService(new InMemoryConsentStore());
  const customerService = new CustomerService(new InMemoryCustomerStore(), ratingService, consentService);
  const goalService = new GoalService(new InMemoryGoalStore());
  const onboardingService = new OnboardingService(tenantService, growthAuditService, socialConnectionService, customerService, goalService);
  const pilotSummaryService = new PilotSummaryService(null, growthAuditService, npsService, onboardingService);

  const supportTicketService = new SupportTicketService(new InMemorySupportTicketStore());
  const supportTicketAdminService = new SupportTicketAdminService(null, supportTicketService);

  const subscriptionService = new SubscriptionService(new InMemorySubscriptionPaymentStore(), tenantService, "test-mopay-platform-key");

  const service = new AdminTenantService(pilotSummaryService, supportTicketAdminService, tenantService, authService, subscriptionService);
  return { service, tenantService, authService };
}

test("listTenants returns an empty list when no real Postgres pool is configured — matches PilotSummaryService's own disclosed limitation", async () => {
  const { service } = makeServices();
  await expect(service.listTenants()).resolves.toEqual([]);
});

test("getTenantDetail throws AdminTenantNotFoundError for a tenant id that was never registered", async () => {
  const { service } = makeServices();
  await expect(service.getTenantDetail(randomUUID())).rejects.toThrow(AdminTenantNotFoundError);
});

test("getTenantDetail returns a real tenant's staff list and subscription payment history, and never leaks its mopayApiKey", async () => {
  const { service, tenantService } = makeServices();
  const { tenantId } = await tenantService.registerTenant(`Detail Test Tenant ${randomUUID()}`, `owner-${randomUUID()}@example.com`, "a-real-password");
  await tenantService.setMopayApiKey(tenantId, "a-real-live-mopay-key");

  const detail = await service.getTenantDetail(tenantId);

  expect(detail.tenantId).toBe(tenantId);
  expect(detail.status).toBe("pilot");
  expect(detail.staff).toHaveLength(1);
  expect(detail.staff[0].role).toBe("owner");
  expect(detail.subscriptionPayments).toEqual([]);
  expect(detail).not.toHaveProperty("mopayApiKey");
  expect(JSON.stringify(detail)).not.toContain("a-real-live-mopay-key");
});

test("suspend flips a real tenant's status to suspended, and reactivate flips it back", async () => {
  const { service, tenantService } = makeServices();
  const { tenantId } = await tenantService.registerTenant(`Suspend Test Tenant ${randomUUID()}`, `owner-${randomUUID()}@example.com`, "a-real-password");

  await service.suspend(tenantId);
  expect((await tenantService.getById(tenantId))?.status).toBe("suspended");

  await service.reactivate(tenantId);
  expect((await tenantService.getById(tenantId))?.status).toBe("active");
});

test("suspend throws AdminTenantNotFoundError for a tenant id that was never registered", async () => {
  const { service } = makeServices();
  await expect(service.suspend(randomUUID())).rejects.toThrow(AdminTenantNotFoundError);
});

test("reactivate throws AdminTenantNotFoundError for a tenant id that was never registered", async () => {
  const { service } = makeServices();
  await expect(service.reactivate(randomUUID())).rejects.toThrow(AdminTenantNotFoundError);
});

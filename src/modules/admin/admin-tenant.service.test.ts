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
import { AuditLogService } from "../audit-log/audit-log.service";
import { InMemoryAuditLogStore } from "../audit-log/in-memory-audit-log.store";

const ACTOR_ADMIN_ID = "test-admin-id";

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
  const auditLogService = new AuditLogService(new InMemoryAuditLogStore());

  const service = new AdminTenantService(pilotSummaryService, supportTicketAdminService, tenantService, authService, subscriptionService, auditLogService);
  return { service, tenantService, authService, auditLogService };
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

  await service.suspend(tenantId, ACTOR_ADMIN_ID);
  expect((await tenantService.getById(tenantId))?.status).toBe("suspended");

  await service.reactivate(tenantId, ACTOR_ADMIN_ID);
  expect((await tenantService.getById(tenantId))?.status).toBe("active");
});

test("suspend throws AdminTenantNotFoundError for a tenant id that was never registered", async () => {
  const { service } = makeServices();
  await expect(service.suspend(randomUUID(), ACTOR_ADMIN_ID)).rejects.toThrow(AdminTenantNotFoundError);
});

test("reactivate throws AdminTenantNotFoundError for a tenant id that was never registered", async () => {
  const { service } = makeServices();
  await expect(service.reactivate(randomUUID(), ACTOR_ADMIN_ID)).rejects.toThrow(AdminTenantNotFoundError);
});

// Closes the real, previously-unused audit_log table gap — every admin
// action against a specific tenant now writes a real, readable row.
test("suspend/reactivate/updateSubscription/setCustomPrice each write a real audit log entry, readable back via getTenantDetail", async () => {
  const { service, tenantService } = makeServices();
  const { tenantId } = await tenantService.registerTenant(`Audit Test Tenant ${randomUUID()}`, `owner-${randomUUID()}@example.com`, "a-real-password");

  await service.suspend(tenantId, ACTOR_ADMIN_ID);
  await service.reactivate(tenantId, ACTOR_ADMIN_ID);
  await service.updateSubscription(tenantId, "pro_plus", "active", undefined, ACTOR_ADMIN_ID);
  await service.setCustomPrice(tenantId, 199, ACTOR_ADMIN_ID);

  const detail = await service.getTenantDetail(tenantId);
  expect(detail.auditLog.map((e) => e.action)).toEqual([
    "tenant.custom_price.set",
    "tenant.subscription.update",
    "tenant.reactivate",
    "tenant.suspend",
  ]);
  for (const entry of detail.auditLog) {
    expect(entry.tenantId).toBe(tenantId);
    expect(entry.metadata).toEqual({ actorAdminId: ACTOR_ADMIN_ID });
  }
});

test("updateSubscription writes the given tier/status/nextBillingDate through to the real tenant record", async () => {
  const { service, tenantService } = makeServices();
  const { tenantId } = await tenantService.registerTenant(`Override Test Tenant ${randomUUID()}`, `owner-${randomUUID()}@example.com`, "a-real-password");

  const nextBillingDate = new Date("2026-12-01T00:00:00.000Z");
  await service.updateSubscription(tenantId, "growth_partner", "active", nextBillingDate, ACTOR_ADMIN_ID);

  const tenant = await tenantService.getById(tenantId);
  expect(tenant?.subscriptionTier).toBe("growth_partner");
  expect(tenant?.subscriptionStatus).toBe("active");
  expect(tenant?.nextBillingDate).toEqual(nextBillingDate);
});

test("updateSubscription omitting nextBillingDate keeps the tenant's existing one, so correcting a stuck status doesn't require guessing a date", async () => {
  const { service, tenantService } = makeServices();
  const { tenantId } = await tenantService.registerTenant(`Preserve Date Tenant ${randomUUID()}`, `owner-${randomUUID()}@example.com`, "a-real-password");
  const originalDate = new Date("2026-11-15T00:00:00.000Z");
  await service.updateSubscription(tenantId, "pro_plus", "past_due", originalDate, ACTOR_ADMIN_ID);

  await service.updateSubscription(tenantId, "pro_plus", "active", undefined, ACTOR_ADMIN_ID);

  const tenant = await tenantService.getById(tenantId);
  expect(tenant?.subscriptionStatus).toBe("active");
  expect(tenant?.nextBillingDate).toEqual(originalDate);
});

test("updateSubscription to the free tier always clears nextBillingDate, even if one was passed", async () => {
  const { service, tenantService } = makeServices();
  const { tenantId } = await tenantService.registerTenant(`Downgrade Tenant ${randomUUID()}`, `owner-${randomUUID()}@example.com`, "a-real-password");
  await service.updateSubscription(tenantId, "growth_plan", "active", new Date("2026-12-01T00:00:00.000Z"), ACTOR_ADMIN_ID);

  await service.updateSubscription(tenantId, "free", "active", new Date("2026-12-01T00:00:00.000Z"), ACTOR_ADMIN_ID);

  const tenant = await tenantService.getById(tenantId);
  expect(tenant?.subscriptionTier).toBe("free");
  expect(tenant?.nextBillingDate).toBeUndefined();
});

test("updateSubscription throws AdminTenantNotFoundError for a tenant id that was never registered", async () => {
  const { service } = makeServices();
  await expect(service.updateSubscription(randomUUID(), "pro_plus", "active", undefined, ACTOR_ADMIN_ID)).rejects.toThrow(AdminTenantNotFoundError);
});

// The tenant's own explicit request: "the administrator should be able
// to set subscription tiers on their own however they want" — a real,
// arbitrary per-tenant price override (migration 0050).
test("setCustomPrice writes a real override, surfaced on both listTenants/getTenantDetail, and null clears it", async () => {
  const { service, tenantService } = makeServices();
  const { tenantId } = await tenantService.registerTenant(`Custom Price Tenant ${randomUUID()}`, `owner-${randomUUID()}@example.com`, "a-real-password");

  await service.setCustomPrice(tenantId, 275, ACTOR_ADMIN_ID);
  const detail = await service.getTenantDetail(tenantId);
  expect(detail.customPriceZar).toBe(275);

  await service.setCustomPrice(tenantId, null, ACTOR_ADMIN_ID);
  expect((await service.getTenantDetail(tenantId)).customPriceZar).toBeNull();
});

test("setCustomPrice throws AdminTenantNotFoundError for a tenant id that was never registered", async () => {
  const { service } = makeServices();
  await expect(service.setCustomPrice(randomUUID(), 100, ACTOR_ADMIN_ID)).rejects.toThrow(AdminTenantNotFoundError);
});

// The GrowthOS platform-admin architecture review's own "+ Create
// Tenant" requirement.
test("createTenant creates a real tenant + owner via the same real path self-service signup uses, and records a real audit entry", async () => {
  const { service, tenantService } = makeServices();
  const tenantName = `Admin-Created Tenant ${randomUUID()}`;
  const ownerEmail = `owner-${randomUUID()}@example.com`;

  const result = await service.createTenant(tenantName, ownerEmail, "a-real-password", ACTOR_ADMIN_ID);

  const tenant = await tenantService.getById(result.tenantId);
  expect(tenant?.name).toBe(tenantName);
  const detail = await service.getTenantDetail(result.tenantId);
  expect(detail.staff).toHaveLength(1);
  expect(detail.staff[0].id).toBe(result.ownerId);
  expect(detail.staff[0].email).toBe(ownerEmail);
  expect(detail.staff[0].role).toBe("owner");
  expect(detail.auditLog).toHaveLength(1);
  expect(detail.auditLog[0]).toMatchObject({ action: "tenant.create", metadata: { actorAdminId: ACTOR_ADMIN_ID } });
});

test("createTenant rejects an empty tenant name — same real validation self-service signup already enforces", async () => {
  const { service } = makeServices();
  await expect(service.createTenant("", "owner@example.com", "a-real-password", ACTOR_ADMIN_ID)).rejects.toThrow();
});

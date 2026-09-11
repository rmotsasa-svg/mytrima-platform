import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { PilotSummaryService } from "./pilot-summary.service";
import { GrowthAuditService } from "../growth-audit/growth-audit.service";
import { InMemoryGrowthAuditResponseStore } from "../growth-audit/in-memory-growth-audit-response.store";
import { NpsService } from "../growth-audit/nps.service";
import { InMemoryNpsResponseStore } from "../growth-audit/in-memory-nps-response.store";
import { OnboardingService } from "../onboarding/onboarding.service";
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
import { runWithTenantContext } from "../../common/postgres";
import { PgGrowthAuditResponseStore } from "../growth-audit/pg-growth-audit-response.store";
import { PgNpsResponseStore } from "../growth-audit/pg-nps-response.store";
import { PgTenantStore } from "../auth/pg-tenant.store";
import { PgAuthUserStore } from "../auth/pg-auth-user.store";
import { ConsoleEmailService } from "../integrations/email/email.service";

function makeRealServices() {
  const growthAuditService = new GrowthAuditService(new InMemoryGrowthAuditResponseStore());
  const npsService = new NpsService(new InMemoryNpsResponseStore());
  const tenantService = new TenantService(
    new InMemoryTenantStore(),
    new AuthService(new InMemoryAuthUserStore(), "test-secret", new InMemoryRevokedRefreshTokenStore(), generateMfaEncryptionKey()),
    new ConsoleEmailService()
  );
  const socialConnectionService = new SocialConnectionService(new InMemorySocialConnectionStore());
  const ratingService = new RatingService(new InMemoryRatingStore());
  const consentService = new ConsentService(new InMemoryConsentStore());
  const customerService = new CustomerService(new InMemoryCustomerStore(), ratingService, consentService);
  const onboardingService = new OnboardingService(tenantService, growthAuditService, socialConnectionService, customerService);
  return { growthAuditService, npsService, onboardingService, tenantService };
}

test("returns an empty, honestly-labeled summary when no real Postgres pool is configured — no in-memory tenant registry exists to enumerate", async () => {
  const { growthAuditService, npsService, onboardingService } = makeRealServices();
  const service = new PilotSummaryService(null, growthAuditService, npsService, onboardingService);

  const summary = await service.getSummary();
  expect(summary.tenantCount).toBe(0);
  expect(summary.tenants).toEqual([]);
});

/**
 * REAL integration test against a live PostgreSQL instance — gated behind
 * TEST_DATABASE_URL, same pattern as every other Pg-backed test in this
 * project. Proves the actual cross-tenant aggregation (deliberately NOT
 * tenant-scoped — see this file's own comment on why an operator view is
 * different from every other endpoint here).
 */
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const maybeDescribe = TEST_DATABASE_URL ? describe : describe.skip;

maybeDescribe("PilotSummaryService against a real PostgreSQL instance", () => {
  const pool = new Pool({ connectionString: TEST_DATABASE_URL });
  const growthAuditService = new GrowthAuditService(new PgGrowthAuditResponseStore(pool));
  const npsService = new NpsService(new PgNpsResponseStore(pool));
  const tenantService = new TenantService(
    new PgTenantStore(pool),
    new AuthService(new PgAuthUserStore(pool), "pilot-summary-test-secret", new InMemoryRevokedRefreshTokenStore(), generateMfaEncryptionKey()),
    new ConsoleEmailService()
  );
  const socialConnectionService = new SocialConnectionService(new InMemorySocialConnectionStore());
  const ratingService = new RatingService(new InMemoryRatingStore());
  const consentService = new ConsentService(new InMemoryConsentStore());
  const customerService = new CustomerService(new InMemoryCustomerStore(), ratingService, consentService);
  const onboardingService = new OnboardingService(tenantService, growthAuditService, socialConnectionService, customerService);
  const service = new PilotSummaryService(pool, growthAuditService, npsService, onboardingService);

  const createdTenantIds: string[] = [];

  afterAll(async () => {
    for (const id of createdTenantIds) {
      await runWithTenantContext(pool, id, (client) => client.query("delete from tenant where id = $1", [id]));
    }
    await pool.end();
  });

  test("getSummary lists every real tenant, cross-tenant, with a real Growth Audit + NPS reflected for the one that submitted them", async () => {
    const { tenantId: activeTenantId } = await tenantService.registerTenant(
      `Active Pilot Tenant ${randomUUID()}`,
      `owner-${randomUUID()}@example.com`,
      "a-real-password"
    );
    createdTenantIds.push(activeTenantId);
    const { tenantId: quietTenantId } = await tenantService.registerTenant(
      `Quiet Pilot Tenant ${randomUUID()}`,
      `owner-${randomUUID()}@example.com`,
      "a-real-password"
    );
    createdTenantIds.push(quietTenantId);

    const answers = Object.fromEntries(Array.from({ length: 40 }, (_, i) => [i + 1, 3]));
    await growthAuditService.submit(activeTenantId, answers, randomUUID());
    await npsService.submit(activeTenantId, randomUUID(), 9, randomUUID());

    const summary = await service.getSummary();
    const active = summary.tenants.find((t) => t.tenantId === activeTenantId);
    const quiet = summary.tenants.find((t) => t.tenantId === quietTenantId);

    expect(active).toBeDefined();
    expect(quiet).toBeDefined(); // both tenants present — this is genuinely cross-tenant, unlike every RLS-scoped endpoint
    expect(active?.growthAuditCount).toBe(1);
    expect(active?.latestGrowthAuditScore).toBeGreaterThan(0);
    expect(active?.npsResponseCount).toBe(1);
    expect(quiet?.growthAuditCount).toBe(0);
    expect(quiet?.latestGrowthAuditScore).toBeNull();
    expect(quiet?.npsScore).toBeNull();
  }, 20000);
});

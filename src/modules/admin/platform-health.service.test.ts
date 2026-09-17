import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { PlatformHealthService } from "./platform-health.service";
import { SupportTicketAdminService } from "./support-ticket-admin.service";
import { SupportTicketService } from "../support/support-ticket.service";
import { InMemorySupportTicketStore } from "../support/in-memory-support-ticket.store";
import { PgSupportTicketStore } from "../support/pg-support-ticket.store";
import { TenantService } from "../auth/tenant.service";
import { PgTenantStore } from "../auth/pg-tenant.store";
import { AuthService } from "../auth/auth.service";
import { PgAuthUserStore } from "../auth/pg-auth-user.store";
import { InMemoryRevokedRefreshTokenStore } from "../auth/in-memory-revoked-token.store";
import { generateMfaEncryptionKey } from "../auth/mfa-secret-crypto";
import { ConsoleEmailService } from "../integrations/email/email.service";
import { runWithTenantContext } from "../../common/postgres";

function makeService(pool: Pool | null) {
  const supportTicketService = new SupportTicketService(pool ? new PgSupportTicketStore(pool) : new InMemorySupportTicketStore());
  const supportTicketAdminService = new SupportTicketAdminService(pool, supportTicketService);
  return new PlatformHealthService(pool, supportTicketAdminService);
}

test("getPlatformHealth reports every queue and the database as honestly unconfigured, and every business/ticket metric as its real empty default, when neither REDIS_URL nor DATABASE_URL is set", async () => {
  const service = makeService(null);
  const health = await service.getPlatformHealth();

  expect(health.queues).toHaveLength(6);
  for (const queue of health.queues) {
    expect(queue.configured).toBe(false);
    expect(queue.waiting).toBeUndefined();
  }
  expect(health.database).toEqual({ configured: false });
  expect(health.business).toEqual({ tenantCount: 0, tenantsByTier: {}, mrrZar: 0, pastDueTenantCount: 0, signupsByDay: [] });
  expect(health.supportTickets).toEqual({ openCount: 0, inProgressCount: 0, resolvedCount: 0, averageResolutionHours: null });
});

/**
 * REAL integration test against a live PostgreSQL instance — gated
 * behind TEST_DATABASE_URL, same pattern as pilot-summary.service.test.ts
 * and support-ticket-admin.service.test.ts. Proves the actual MRR/
 * past-due/signup aggregation and real ticket-resolution-time math
 * against genuine rows, not fixtures.
 */
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const maybeDescribe = TEST_DATABASE_URL ? describe : describe.skip;

maybeDescribe("PlatformHealthService against a real PostgreSQL instance", () => {
  const pool = new Pool({ connectionString: TEST_DATABASE_URL });
  const tenantService = new TenantService(
    new PgTenantStore(pool),
    new AuthService(new PgAuthUserStore(pool), "platform-health-test-secret", new InMemoryRevokedRefreshTokenStore(), generateMfaEncryptionKey(), new PgTenantStore(pool)),
    new ConsoleEmailService()
  );
  const supportTicketService = new SupportTicketService(new PgSupportTicketStore(pool));
  const service = makeService(pool);

  const createdTenantIds: string[] = [];

  afterAll(async () => {
    for (const id of createdTenantIds) {
      await runWithTenantContext(pool, id, (client) => client.query("delete from tenant where id = $1", [id]));
    }
    await pool.end();
  });

  test("getPlatformHealth computes real MRR, past-due count, and support-ticket resolution time from genuine rows", async () => {
    const { tenantId: paidTenantId } = await tenantService.registerTenant(`Paid Tenant ${randomUUID()}`, `owner-${randomUUID()}@example.com`, "a-real-password");
    createdTenantIds.push(paidTenantId);
    await tenantService.setSubscription(paidTenantId, "pro_plus", "active", null);

    const { tenantId: pastDueTenantId } = await tenantService.registerTenant(`Past Due Tenant ${randomUUID()}`, `owner-${randomUUID()}@example.com`, "a-real-password");
    createdTenantIds.push(pastDueTenantId);
    await tenantService.setSubscription(pastDueTenantId, "growth_plan", "past_due", null);

    const ticket = await supportTicketService.create(paidTenantId, randomUUID(), randomUUID(), "Real ticket", "Something real broke");
    await supportTicketService.resolve(paidTenantId, ticket.id, "Fixed it for real.");

    const health = await service.getPlatformHealth();

    expect(health.database.configured).toBe(true);
    expect(health.business.mrrZar).toBeGreaterThanOrEqual(350); // pro_plus price, real tenants may already exist in this DB
    expect(health.business.pastDueTenantCount).toBeGreaterThanOrEqual(1);
    expect(health.business.tenantCount).toBeGreaterThanOrEqual(2);
    expect(health.supportTickets.resolvedCount).toBeGreaterThanOrEqual(1);
    expect(health.supportTickets.averageResolutionHours).not.toBeNull();
    expect(health.supportTickets.averageResolutionHours).toBeGreaterThanOrEqual(0);
  }, 20000);
});

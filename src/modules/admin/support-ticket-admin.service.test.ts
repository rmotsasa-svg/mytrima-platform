import { randomUUID } from "node:crypto";
import { Pool } from "pg";
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
import { runWithTenantContext } from "../../common/postgres";
import { ConsoleEmailService } from "../integrations/email/email.service";

test("returns an empty list when no real Postgres pool is configured — no in-memory tenant registry exists to enumerate", async () => {
  const supportTicketService = new SupportTicketService(new InMemorySupportTicketStore());
  const service = new SupportTicketAdminService(null, supportTicketService);
  await expect(service.listAcrossTenants()).resolves.toEqual([]);
});

/**
 * REAL integration test against a live PostgreSQL instance — gated behind
 * TEST_DATABASE_URL, same pattern as pilot-summary.service.test.ts. Proves
 * the actual cross-tenant aggregation and that markInProgress/resolve
 * really reach the right tenant's row (each call needs the correct
 * tenant_id to pass RLS — see PgSupportTicketStore's own comment).
 */
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const maybeDescribe = TEST_DATABASE_URL ? describe : describe.skip;

maybeDescribe("SupportTicketAdminService against a real PostgreSQL instance", () => {
  const pool = new Pool({ connectionString: TEST_DATABASE_URL });
  const supportTicketService = new SupportTicketService(new PgSupportTicketStore(pool));
  const tenantService = new TenantService(
    new PgTenantStore(pool),
    new AuthService(new PgAuthUserStore(pool), "support-admin-test-secret", new InMemoryRevokedRefreshTokenStore(), generateMfaEncryptionKey()),
    new ConsoleEmailService()
  );
  const service = new SupportTicketAdminService(pool, supportTicketService);

  const createdTenantIds: string[] = [];

  afterAll(async () => {
    for (const id of createdTenantIds) {
      await runWithTenantContext(pool, id, (client) => client.query("delete from tenant where id = $1", [id]));
    }
    await pool.end();
  });

  test("listAcrossTenants sees every real tenant's tickets, and resolve() reaches the right tenant's row under RLS", async () => {
    const { tenantId, owner } = await tenantService.registerTenant(
      `Support Test Tenant ${randomUUID()}`,
      `owner-${randomUUID()}@example.com`,
      "a-real-password"
    );
    createdTenantIds.push(tenantId);

    const ticket = await supportTicketService.create(tenantId, randomUUID(), owner.id, "Real ticket", "Something is broken");

    const list = await service.listAcrossTenants();
    expect(list.some((t) => t.id === ticket.id)).toBe(true);

    const inProgress = await service.markInProgress(tenantId, ticket.id);
    expect(inProgress.status).toBe("in_progress");

    const resolved = await service.resolve(tenantId, ticket.id, "Fixed the real underlying issue.");
    expect(resolved.status).toBe("resolved");
    expect(resolved.resolutionNotes).toBe("Fixed the real underlying issue.");
  }, 20000);
});

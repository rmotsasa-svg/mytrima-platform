import { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { SupportTicketService } from "./support-ticket.service";
import { PgSupportTicketStore } from "./pg-support-ticket.store";
import { TenantService } from "../auth/tenant.service";
import { PgTenantStore } from "../auth/pg-tenant.store";
import { AuthService } from "../auth/auth.service";
import { PgAuthUserStore } from "../auth/pg-auth-user.store";
import { InMemoryRevokedRefreshTokenStore } from "../auth/in-memory-revoked-token.store";
import { generateMfaEncryptionKey } from "../auth/mfa-secret-crypto";
import { runWithTenantContext } from "../../common/postgres";
import { ConsoleEmailService } from "../integrations/email/email.service";

/**
 * REAL integration test against a live PostgreSQL instance — gated behind
 * TEST_DATABASE_URL, same as every other pg store test here. Exercises the
 * real `support_ticket` table (0021_support_ticket.sql) and its real
 * foreign key to a real `app_user` row (created via TenantService's own
 * registerTenant()/AuthService), plus this project's own RLS-tenant-context
 * lesson: the resolve() status-transition UPDATE must run inside
 * runWithTenantContext or RLS silently matches zero rows.
 */
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const maybeDescribe = TEST_DATABASE_URL ? describe : describe.skip;

maybeDescribe("PgSupportTicketStore + SupportTicketService against a real PostgreSQL instance", () => {
  const pool = new Pool({ connectionString: TEST_DATABASE_URL });
  const tenantService = new TenantService(
    new PgTenantStore(pool),
    new AuthService(new PgAuthUserStore(pool), "support-ticket-test-secret", new InMemoryRevokedRefreshTokenStore(), generateMfaEncryptionKey()),
    new ConsoleEmailService()
  );
  const supportTicketService = new SupportTicketService(new PgSupportTicketStore(pool));

  const createdTenantIds: string[] = [];

  afterAll(async () => {
    for (const id of createdTenantIds) {
      await runWithTenantContext(pool, id, (client) => client.query("delete from tenant where id = $1", [id]));
    }
    await pool.end();
  });

  test("create persists a real row against a real app_user foreign key, and resolve() really updates it under RLS", async () => {
    const { tenantId, owner } = await tenantService.registerTenant(
      `Support Ticket Test Tenant ${randomUUID()}`,
      `owner-${randomUUID()}@example.com`,
      "a-real-password"
    );
    createdTenantIds.push(tenantId);

    const ticket = await supportTicketService.create(tenantId, randomUUID(), owner.id, "Real subject", "Real description");
    expect(ticket.status).toBe("open");

    const resolved = await supportTicketService.resolve(tenantId, ticket.id, "Fixed for real.");
    expect(resolved.status).toBe("resolved");

    const reread = await supportTicketService.findById(tenantId, ticket.id);
    expect(reread?.status).toBe("resolved");
    expect(reread?.resolutionNotes).toBe("Fixed for real.");
  }, 20000);

  test("listForTenant is tenant-scoped, enforced by RLS", async () => {
    const { tenantId: tenantA, owner: ownerA } = await tenantService.registerTenant(
      `Support Ticket Tenant A ${randomUUID()}`,
      `owner-a-${randomUUID()}@example.com`,
      "a-real-password"
    );
    createdTenantIds.push(tenantA);
    const { tenantId: tenantB, owner: ownerB } = await tenantService.registerTenant(
      `Support Ticket Tenant B ${randomUUID()}`,
      `owner-b-${randomUUID()}@example.com`,
      "a-real-password"
    );
    createdTenantIds.push(tenantB);

    await supportTicketService.create(tenantA, randomUUID(), ownerA.id, "Tenant A issue", "Description");
    await supportTicketService.create(tenantB, randomUUID(), ownerB.id, "Tenant B issue", "Description");

    const listA = await supportTicketService.listForTenant(tenantA);
    expect(listA.every((t) => t.tenantId === tenantA)).toBe(true);
    expect(listA.some((t) => t.subject === "Tenant B issue")).toBe(false);
  }, 20000);
});

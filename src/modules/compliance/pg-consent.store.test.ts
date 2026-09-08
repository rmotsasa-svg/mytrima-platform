import { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { ConsentService } from "./consent.service";
import { PgConsentStore } from "./pg-consent.store";
import { runWithTenantContext } from "../../common/postgres";

/**
 * REAL integration test against a live PostgreSQL instance — gated behind
 * TEST_DATABASE_URL. See src/common/postgres.test.ts for the connection
 * requirements (must be the non-superuser mytrima_app role, or RLS is
 * bypassed and this test proves nothing).
 */
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const maybeDescribe = TEST_DATABASE_URL ? describe : describe.skip;

maybeDescribe("PgConsentStore + ConsentService against a real PostgreSQL instance", () => {
  const pool = new Pool({ connectionString: TEST_DATABASE_URL });
  const service = new ConsentService(new PgConsentStore(pool));
  const tenantId = randomUUID();
  const customerId = randomUUID();

  beforeAll(async () => {
    // `tenant` carries no RLS (top-level registry), so a plain insert is
    // fine. `customer` DOES carry RLS with a WITH CHECK clause — inserting
    // via a plain pool.query() with no app.current_tenant_id set is
    // rejected by Postgres itself ("new row violates row-level security
    // policy"), caught the hard way writing this test before switching to
    // runWithTenantContext here too, same as every real store method.
    await pool.query("insert into tenant (id, name) values ($1, 'PgConsentStore test tenant')", [tenantId]);
    await runWithTenantContext(pool, tenantId, (client) =>
      client.query("insert into customer (id, tenant_id, display_name) values ($1, $2, 'Test customer')", [customerId, tenantId])
    );
  });

  afterAll(async () => {
    await pool.query("delete from tenant where id = $1", [tenantId]); // cascades to customer + consent_record
    await pool.end();
  });

  test("grant then assertHasConsent succeeds against the real database", async () => {
    await service.grant(tenantId, customerId, "whatsapp_marketing", "consent", randomUUID());
    const record = await service.assertHasConsent(tenantId, customerId, "whatsapp_marketing");
    expect(record.lawfulBasis).toBe("consent");
  });

  test("revoke actually persists to the real database — assertHasConsent then fails on re-fetch", async () => {
    const id = randomUUID();
    await service.grant(tenantId, customerId, "survey_response", "consent", id);
    await service.revoke(tenantId, id);
    await expect(service.assertHasConsent(tenantId, customerId, "survey_response")).rejects.toThrow();
  });

  test("revoke with the wrong tenantId does not touch a real row — enforced by RLS, not app logic", async () => {
    const id = randomUUID();
    const otherTenantId = randomUUID();
    await pool.query("insert into tenant (id, name) values ($1, 'other tenant')", [otherTenantId]);

    await service.grant(tenantId, customerId, "review_publication", "consent", id);
    await service.revoke(otherTenantId, id); // wrong tenant — should have no effect
    const record = await service.assertHasConsent(tenantId, customerId, "review_publication");
    expect(record.revokedAt).toBeUndefined();

    await pool.query("delete from tenant where id = $1", [otherTenantId]);
  });

  test("exportForDsar returns every record for a customer, including revoked ones, from the real database", async () => {
    const id1 = randomUUID();
    const id2 = randomUUID();
    await service.grant(tenantId, customerId, "data_category_a", "consent", id1);
    await service.grant(tenantId, customerId, "data_category_b", "consent", id2);
    await service.revoke(tenantId, id2);

    const all = await service.exportForDsar(tenantId, customerId);
    const ids = all.map((r) => r.id);
    expect(ids).toContain(id1);
    expect(ids).toContain(id2);
  });
});

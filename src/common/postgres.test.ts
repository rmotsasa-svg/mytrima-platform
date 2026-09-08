import { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { runWithTenantContext } from "./postgres";

/**
 * REAL integration test against a live PostgreSQL instance — not mocked,
 * unlike mopay.service.test.ts/google-business.service.test.ts, because a
 * real local Postgres is genuinely available to test against (installed and
 * migrated specifically to close this exact gap — see README.md's "RLS:
 * proven live" section). Gated behind TEST_DATABASE_URL so `npm test` stays
 * green on any machine without one.
 *
 * TEST_DATABASE_URL must point to the non-superuser `mytrima_app` role
 * (created per db/tests/rls_negative.sql's own prerequisite) against a
 * database with 0001_tenant_and_rls.sql already applied — e.g.:
 *   postgresql://mytrima_app:<password>@localhost:5432/mytrima
 * A superuser connection would bypass RLS entirely and make this test pass
 * vacuously without proving anything.
 */
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const maybeDescribe = TEST_DATABASE_URL ? describe : describe.skip;

maybeDescribe("runWithTenantContext against a real PostgreSQL instance", () => {
  // max: 1 deliberately forces every call below through the SAME physical
  // connection — the worst case for the exact "session-scoped settings and
  // connection pooling have known interaction pitfalls" concern
  // db/tests/rls_negative.test.md originally flagged. If tenant context ever
  // leaked between borrowers of a pooled connection, this configuration is
  // what would expose it.
  const pool = new Pool({ connectionString: TEST_DATABASE_URL, max: 1 });
  const tenantAId = randomUUID();
  const tenantBId = randomUUID();

  beforeAll(async () => {
    // `tenant` itself carries no RLS (it's the top-level registry, not
    // tenant-scoped data) — a plain insert is correct here.
    await pool.query("insert into tenant (id, name) values ($1, 'Postgres pooling test A'), ($2, 'Postgres pooling test B')", [
      tenantAId,
      tenantBId,
    ]);
  });

  afterAll(async () => {
    // ON DELETE CASCADE (0001_tenant_and_rls.sql) removes the customer rows
    // created below along with their parent tenant rows.
    await pool.query("delete from tenant where id = $1 or id = $2", [tenantAId, tenantBId]);
    await pool.end();
  });

  test("two tenants sharing the same single pooled connection never see each other's rows", async () => {
    await runWithTenantContext(pool, tenantAId, (client) =>
      client.query("insert into customer (tenant_id, display_name) values ($1, $2)", [tenantAId, "Customer A"])
    );
    await runWithTenantContext(pool, tenantBId, (client) =>
      client.query("insert into customer (tenant_id, display_name) values ($1, $2)", [tenantBId, "Customer B"])
    );

    const asTenantA = await runWithTenantContext(pool, tenantAId, (client) =>
      client.query("select display_name from customer where tenant_id = $1 or tenant_id = $2", [tenantAId, tenantBId])
    );
    expect(asTenantA.rows).toHaveLength(1);
    expect(asTenantA.rows[0].display_name).toBe("Customer A");

    const asTenantB = await runWithTenantContext(pool, tenantBId, (client) =>
      client.query("select display_name from customer where tenant_id = $1 or tenant_id = $2", [tenantAId, tenantBId])
    );
    expect(asTenantB.rows).toHaveLength(1);
    expect(asTenantB.rows[0].display_name).toBe("Customer B");
  });

  test("a cross-tenant INSERT is rejected by WITH CHECK even through a reused pooled connection", async () => {
    await expect(
      runWithTenantContext(pool, tenantAId, (client) =>
        client.query("insert into customer (tenant_id, display_name) values ($1, $2)", [tenantBId, "Should be rejected"])
      )
    ).rejects.toThrow();
  });

  test("a failed query inside runWithTenantContext rolls back rather than leaving a half-committed transaction", async () => {
    await expect(
      runWithTenantContext(pool, tenantAId, async (client) => {
        await client.query("insert into customer (tenant_id, display_name) values ($1, $2)", [tenantAId, "Should be rolled back"]);
        await client.query("select * from a_table_that_does_not_exist");
      })
    ).rejects.toThrow();

    const result = await runWithTenantContext(pool, tenantAId, (client) =>
      client.query("select count(*) from customer where tenant_id = $1 and display_name = $2", [tenantAId, "Should be rolled back"])
    );
    expect(Number(result.rows[0].count)).toBe(0);
  });
});

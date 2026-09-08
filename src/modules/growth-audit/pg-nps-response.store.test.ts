import { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { NpsService } from "./nps.service";
import { PgNpsResponseStore } from "./pg-nps-response.store";
import { runWithTenantContext } from "../../common/postgres";

/**
 * REAL integration test against a live PostgreSQL instance — gated behind
 * TEST_DATABASE_URL. See src/common/postgres.test.ts for the connection
 * requirements.
 */
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const maybeDescribe = TEST_DATABASE_URL ? describe : describe.skip;

maybeDescribe("PgNpsResponseStore + NpsService against a real PostgreSQL instance", () => {
  const pool = new Pool({ connectionString: TEST_DATABASE_URL });
  const service = new NpsService(new PgNpsResponseStore(pool));
  const tenantId = randomUUID();
  const customerId = randomUUID();

  beforeAll(async () => {
    await pool.query("insert into tenant (id, name) values ($1, 'PgNpsResponseStore test tenant')", [tenantId]);
    await runWithTenantContext(pool, tenantId, (client) =>
      client.query("insert into customer (id, tenant_id, display_name) values ($1, $2, 'Test customer')", [customerId, tenantId])
    );
  });

  afterAll(async () => {
    // runWithTenantContext — this DELETE cascades into RLS-protected
    // customer/nps_response rows, and this connection has run set_config()
    // before; see postgres.ts's comment on the empty-string-after-commit
    // footgun a plain pool.query() would hit here.
    await runWithTenantContext(pool, tenantId, (client) => client.query("delete from tenant where id = $1", [tenantId]));
    await pool.end();
  });

  test("submit persists a real response, computed into a real aggregate", async () => {
    await service.submit(tenantId, customerId, 10, randomUUID());
    const agg = await service.aggregateForTenant(tenantId);
    expect(agg.count).toBeGreaterThanOrEqual(1);
  });

  test("aggregateForTenant is tenant-scoped, enforced by RLS", async () => {
    const otherTenantId = randomUUID();
    await pool.query("insert into tenant (id, name) values ($1, 'other tenant')", [otherTenantId]);
    const aggOther = await service.aggregateForTenant(otherTenantId);
    expect(aggOther.count).toBe(0);
    await runWithTenantContext(pool, otherTenantId, (client) => client.query("delete from tenant where id = $1", [otherTenantId]));
  });

  test("hand-calculated NPS matches the engine, computed from real rows", async () => {
    const isolatedTenantId = randomUUID();
    const isolatedCustomerId = randomUUID();
    await pool.query("insert into tenant (id, name) values ($1, 'isolated nps tenant')", [isolatedTenantId]);
    await runWithTenantContext(pool, isolatedTenantId, (client) =>
      client.query("insert into customer (id, tenant_id, display_name) values ($1, $2, 'Isolated customer')", [
        isolatedCustomerId,
        isolatedTenantId,
      ])
    );

    await service.submit(isolatedTenantId, isolatedCustomerId, 9, randomUUID()); // promoter
    await service.submit(isolatedTenantId, isolatedCustomerId, 9, randomUUID()); // promoter
    await service.submit(isolatedTenantId, isolatedCustomerId, 3, randomUUID()); // detractor

    const agg = await service.aggregateForTenant(isolatedTenantId);
    expect(agg.count).toBe(3);
    // 2/3 promoters (66.67%), 1/3 detractors (33.33%) -> round(66.67 - 33.33) = 33
    expect(agg.nps).toBe(33);

    await runWithTenantContext(pool, isolatedTenantId, (client) =>
      client.query("delete from tenant where id = $1", [isolatedTenantId])
    );
  });

  test("submit against a non-existent customer fails the real foreign-key constraint", async () => {
    await expect(service.submit(tenantId, randomUUID(), 5, randomUUID())).rejects.toThrow();
  });
});

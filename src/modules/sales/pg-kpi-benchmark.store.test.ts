import { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { KpiBenchmarkService } from "./kpi-benchmark.service";
import { PgKpiBenchmarkStore } from "./pg-kpi-benchmark.store";
import { runWithTenantContext } from "../../common/postgres";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const maybeDescribe = TEST_DATABASE_URL ? describe : describe.skip;

maybeDescribe("PgKpiBenchmarkStore + KpiBenchmarkService against a real PostgreSQL instance", () => {
  const pool = new Pool({ connectionString: TEST_DATABASE_URL });
  const service = new KpiBenchmarkService(new PgKpiBenchmarkStore(pool));
  const tenantId = randomUUID();

  beforeAll(async () => {
    await pool.query("insert into tenant (id, name) values ($1, 'PgKpiBenchmarkStore test tenant')", [tenantId]);
  });

  afterAll(async () => {
    await runWithTenantContext(pool, tenantId, (client) => client.query("delete from tenant where id = $1", [tenantId]));
    await pool.end();
  });

  test("setBenchmark persists a real row, retrievable by listActiveForTenant", async () => {
    await service.setBenchmark(tenantId, randomUUID(), "sales_amount", "below", 5000, new Date("2026-01-01"), new Date("2026-01-31"));
    const list = await service.listActiveForTenant(tenantId);
    expect(list.some((b) => b.thresholdValue === 5000 && b.kpi === "sales_amount")).toBe(true);
  });

  test("listActiveForTenant is tenant-scoped, enforced by RLS", async () => {
    const otherTenantId = randomUUID();
    await pool.query("insert into tenant (id, name) values ($1, 'other tenant')", [otherTenantId]);
    await service.setBenchmark(otherTenantId, randomUUID(), "sales_amount", "below", 9999, new Date("2026-01-01"), new Date("2026-01-31"));

    const list = await service.listActiveForTenant(tenantId);
    expect(list.every((b) => b.tenantId === tenantId)).toBe(true);

    await runWithTenantContext(pool, otherTenantId, (client) => client.query("delete from tenant where id = $1", [otherTenantId]));
  });
});

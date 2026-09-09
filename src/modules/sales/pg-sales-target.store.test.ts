import { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { SalesTargetService } from "./sales-target.service";
import { PgSalesTargetStore } from "./pg-sales-target.store";
import { runWithTenantContext } from "../../common/postgres";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const maybeDescribe = TEST_DATABASE_URL ? describe : describe.skip;

maybeDescribe("PgSalesTargetStore + SalesTargetService against a real PostgreSQL instance", () => {
  const pool = new Pool({ connectionString: TEST_DATABASE_URL });
  const service = new SalesTargetService(new PgSalesTargetStore(pool));
  const tenantId = randomUUID();

  beforeAll(async () => {
    await pool.query("insert into tenant (id, name) values ($1, 'PgSalesTargetStore test tenant')", [tenantId]);
  });

  afterAll(async () => {
    await runWithTenantContext(pool, tenantId, (client) => client.query("delete from tenant where id = $1", [tenantId]));
    await pool.end();
  });

  test("setTarget persists a real tenant-level target row", async () => {
    await service.setTarget(tenantId, randomUUID(), new Date("2026-01-01"), new Date("2026-01-31"), 5000);
    const list = await service.listForTenant(tenantId);
    expect(list.some((t) => t.targetAmount === 5000 && t.userId === undefined)).toBe(true);
  });

  test("listForTenant is tenant-scoped, enforced by RLS", async () => {
    const otherTenantId = randomUUID();
    await pool.query("insert into tenant (id, name) values ($1, 'other tenant')", [otherTenantId]);
    await service.setTarget(otherTenantId, randomUUID(), new Date("2026-01-01"), new Date("2026-01-31"), 9999);

    const list = await service.listForTenant(tenantId);
    expect(list.every((t) => t.tenantId === tenantId)).toBe(true);

    await runWithTenantContext(pool, otherTenantId, (client) => client.query("delete from tenant where id = $1", [otherTenantId]));
  });
});

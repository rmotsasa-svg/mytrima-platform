import { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { CatalogService } from "./catalog-item.service";
import { PgCatalogItemStore } from "./pg-catalog-item.store";
import { runWithTenantContext } from "../../common/postgres";

/**
 * REAL integration test against a live PostgreSQL instance — gated behind
 * TEST_DATABASE_URL. See src/common/postgres.test.ts for the connection
 * requirements.
 */
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const maybeDescribe = TEST_DATABASE_URL ? describe : describe.skip;

maybeDescribe("PgCatalogItemStore + CatalogService against a real PostgreSQL instance", () => {
  const pool = new Pool({ connectionString: TEST_DATABASE_URL });
  const service = new CatalogService(new PgCatalogItemStore(pool));
  const tenantId = randomUUID();

  beforeAll(async () => {
    await pool.query("insert into tenant (id, name) values ($1, 'PgCatalogItemStore test tenant')", [tenantId]);
  });

  afterAll(async () => {
    await runWithTenantContext(pool, tenantId, (client) => client.query("delete from tenant where id = $1", [tenantId]));
    await pool.end();
  });

  test("create persists a real row, and update leaves an unspecified field untouched", async () => {
    const item = await service.create(tenantId, randomUUID(), "Real Haircut", "service", 150, "SKU-REAL");
    const list = await service.listForTenant(tenantId);
    expect(list.find((i) => i.id === item.id)?.name).toBe("Real Haircut");

    const updated = await service.update(tenantId, item.id, "Renamed Haircut");
    expect(updated.name).toBe("Renamed Haircut");
    expect(updated.unitPrice).toBe(150);
    expect(updated.sku).toBe("SKU-REAL");
  });

  test("listForTenant is tenant-scoped, enforced by RLS", async () => {
    const otherTenantId = randomUUID();
    await pool.query("insert into tenant (id, name) values ($1, 'other tenant')", [otherTenantId]);
    await service.create(otherTenantId, randomUUID(), "Other tenant's item", "product", 5);

    const list = await service.listForTenant(tenantId);
    expect(list.some((i) => i.name === "Other tenant's item")).toBe(false);

    await runWithTenantContext(pool, otherTenantId, (client) => client.query("delete from tenant where id = $1", [otherTenantId]));
  });
});

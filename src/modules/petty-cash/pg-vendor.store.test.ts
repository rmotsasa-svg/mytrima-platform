import { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { VendorService } from "./vendor.service";
import { PgVendorStore } from "./pg-vendor.store";
import { runWithTenantContext } from "../../common/postgres";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const maybeDescribe = TEST_DATABASE_URL ? describe : describe.skip;

maybeDescribe("PgVendorStore + VendorService against a real PostgreSQL instance", () => {
  const pool = new Pool({ connectionString: TEST_DATABASE_URL });
  const service = new VendorService(new PgVendorStore(pool));
  const tenantId = randomUUID();

  beforeAll(async () => {
    await pool.query("insert into tenant (id, name) values ($1, 'PgVendorStore test tenant')", [tenantId]);
  });

  afterAll(async () => {
    await runWithTenantContext(pool, tenantId, (client) => client.query("delete from tenant where id = $1", [tenantId]));
    await pool.end();
  });

  test("create persists a real vendor row", async () => {
    const vendor = await service.create(tenantId, randomUUID(), "Real Vendor", "+26650001111");
    const list = await service.listForTenant(tenantId);
    expect(list.find((v) => v.id === vendor.id)?.name).toBe("Real Vendor");
  });

  test("listForTenant is tenant-scoped, enforced by RLS", async () => {
    const otherTenantId = randomUUID();
    await pool.query("insert into tenant (id, name) values ($1, 'other tenant')", [otherTenantId]);
    await service.create(otherTenantId, randomUUID(), "Other tenant's vendor");

    const list = await service.listForTenant(tenantId);
    expect(list.some((v) => v.name === "Other tenant's vendor")).toBe(false);

    await runWithTenantContext(pool, otherTenantId, (client) => client.query("delete from tenant where id = $1", [otherTenantId]));
  });
});

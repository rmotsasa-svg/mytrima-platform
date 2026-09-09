import { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { VendorService } from "./vendor.service";
import { PgVendorStore } from "./pg-vendor.store";
import { PettyCashService } from "./petty-cash.service";
import { PgPettyCashStore } from "./pg-petty-cash.store";
import { runWithTenantContext } from "../../common/postgres";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const maybeDescribe = TEST_DATABASE_URL ? describe : describe.skip;

maybeDescribe("PgPettyCashStore + PettyCashService against a real PostgreSQL instance", () => {
  const pool = new Pool({ connectionString: TEST_DATABASE_URL });
  const vendorService = new VendorService(new PgVendorStore(pool));
  const pettyCashService = new PettyCashService(new PgPettyCashStore(pool), vendorService);
  const tenantId = randomUUID();

  beforeAll(async () => {
    await pool.query("insert into tenant (id, name) values ($1, 'PgPettyCashStore test tenant')", [tenantId]);
  });

  afterAll(async () => {
    await runWithTenantContext(pool, tenantId, (client) => client.query("delete from tenant where id = $1", [tenantId]));
    await pool.end();
  });

  test("replenish then payVendor persist real rows, and the balance reflects both", async () => {
    const vendor = await vendorService.create(tenantId, randomUUID(), "Real Vendor");
    await pettyCashService.replenish(tenantId, randomUUID(), 500, "Weekly float top-up");
    await pettyCashService.payVendor(tenantId, randomUUID(), vendor.id, 120, "Delivery fee");

    const balance = await pettyCashService.getBalance(tenantId);
    expect(balance).toBe(380);
  });

  test("the ledger is tenant-scoped, enforced by RLS", async () => {
    const otherTenantId = randomUUID();
    await pool.query("insert into tenant (id, name) values ($1, 'other tenant')", [otherTenantId]);
    await pettyCashService.replenish(otherTenantId, randomUUID(), 9999);

    const balance = await pettyCashService.getBalance(tenantId);
    expect(balance).toBe(380); // unaffected by the other tenant's replenishment

    await runWithTenantContext(pool, otherTenantId, (client) => client.query("delete from tenant where id = $1", [otherTenantId]));
  });
});

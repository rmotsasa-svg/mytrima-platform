import { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { CatalogService } from "../catalog/catalog-item.service";
import { PgCatalogItemStore } from "../catalog/pg-catalog-item.store";
import { DealService } from "./deal.service";
import { PgDealStore } from "./pg-deal.store";
import { runWithTenantContext } from "../../common/postgres";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const maybeDescribe = TEST_DATABASE_URL ? describe : describe.skip;

maybeDescribe("PgDealStore + DealService against a real PostgreSQL instance", () => {
  const pool = new Pool({ connectionString: TEST_DATABASE_URL });
  const catalogService = new CatalogService(new PgCatalogItemStore(pool));
  const dealService = new DealService(new PgDealStore(pool), catalogService);
  const tenantId = randomUUID();

  beforeAll(async () => {
    await pool.query("insert into tenant (id, name) values ($1, 'PgDealStore test tenant')", [tenantId]);
  });

  afterAll(async () => {
    await runWithTenantContext(pool, tenantId, (client) => client.query("delete from tenant where id = $1", [tenantId]));
    await pool.end();
  });

  test("create persists a real deal row and its real catalog-item links", async () => {
    const item1 = await catalogService.create(tenantId, randomUUID(), "Haircut", "service", 150);
    const item2 = await catalogService.create(tenantId, randomUUID(), "Beard trim", "service", 60);

    const deal = await dealService.create(tenantId, randomUUID(), {
      name: "20% off grooming",
      discountType: "percentage_off",
      percentageOff: 20,
      catalogItemIds: [item1.id, item2.id],
    });

    const found = await dealService.findById(tenantId, deal.id);
    expect(found?.percentageOff).toBe(20);
    expect(found?.catalogItemIds.sort()).toEqual([item1.id, item2.id].sort());
  });

  test("create rejects a catalog item id belonging to a different tenant, enforced by RLS", async () => {
    const otherTenantId = randomUUID();
    await pool.query("insert into tenant (id, name) values ($1, 'other tenant')", [otherTenantId]);
    const otherItem = await catalogService.create(otherTenantId, randomUUID(), "Other tenant's item", "product", 10);

    await expect(
      dealService.create(tenantId, randomUUID(), { name: "Cross-tenant deal", discountType: "fixed_amount_off", fixedAmountOff: 5, catalogItemIds: [otherItem.id] })
    ).rejects.toThrow();

    await runWithTenantContext(pool, otherTenantId, (client) => client.query("delete from tenant where id = $1", [otherTenantId]));
  });
});

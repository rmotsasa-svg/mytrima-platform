import { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { KpiBenchmarkCheckService } from "./kpi-benchmark-check.service";
import { KpiBenchmarkService } from "./kpi-benchmark.service";
import { PgKpiBenchmarkStore } from "./pg-kpi-benchmark.store";
import { SaleService } from "./sale.service";
import { PgSaleStore } from "./pg-sale.store";
import { DealService } from "../deals/deal.service";
import { PgDealStore } from "../deals/pg-deal.store";
import { CatalogService } from "../catalog/catalog-item.service";
import { PgCatalogItemStore } from "../catalog/pg-catalog-item.store";
import { RatingService } from "../reputation/rating.service";
import { PgRatingStore } from "../reputation/pg-rating.store";
import { NpsService } from "../growth-audit/nps.service";
import { PgNpsResponseStore } from "../growth-audit/pg-nps-response.store";
import { NotificationDeliveryService } from "../automation/notification-delivery.service";
import { runWithTenantContext } from "../../common/postgres";

test("checkAllTenants returns 0 and does nothing when there is no pool (DATABASE_URL unset)", async () => {
  const service = new KpiBenchmarkCheckService(
    null,
    new KpiBenchmarkService({ save: async () => {}, findAllActiveForTenant: async () => [] }),
    new SaleService({ save: async () => {}, findAllForTenant: async () => [] }, undefined as never, undefined as never, undefined as never),
    new NotificationDeliveryService(null)
  );
  await expect(service.checkAllTenants()).resolves.toBe(0);
});

/**
 * REAL integration test against a live PostgreSQL instance — gated behind
 * TEST_DATABASE_URL. Proves checkAllTenants()'s own aggregation/comparison
 * logic against real sales and benchmark rows; the scheduling mechanism
 * itself (upsertJobScheduler, the real Worker) follows the identical,
 * already-proven pattern RevokedTokenCleanupService's own test file
 * verifies — not re-proven here.
 */
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const maybeDescribeDb = TEST_DATABASE_URL ? describe : describe.skip;

maybeDescribeDb("KpiBenchmarkCheckService.checkAllTenants against a real PostgreSQL instance", () => {
  const pool = new Pool({ connectionString: TEST_DATABASE_URL });
  const catalogService = new CatalogService(new PgCatalogItemStore(pool));
  const dealService = new DealService(new PgDealStore(pool), catalogService);
  const ratingService = new RatingService(new PgRatingStore(pool));
  const npsService = new NpsService(new PgNpsResponseStore(pool));
  const saleService = new SaleService(new PgSaleStore(pool), dealService, ratingService, npsService);
  const kpiBenchmarkService = new KpiBenchmarkService(new PgKpiBenchmarkStore(pool));
  const checkService = new KpiBenchmarkCheckService(pool, kpiBenchmarkService, saleService, new NotificationDeliveryService(null));
  const tenantId = randomUUID();

  beforeAll(async () => {
    await pool.query("insert into tenant (id, name) values ($1, 'KpiBenchmarkCheckService test tenant')", [tenantId]);
  });

  afterAll(async () => {
    await runWithTenantContext(pool, tenantId, (client) => client.query("delete from tenant where id = $1", [tenantId]));
    await pool.end();
  });

  test("a genuinely breached benchmark is counted; a satisfied one is not", async () => {
    const periodStart = new Date(Date.now() - 60 * 60 * 1000);
    const periodEnd = new Date(Date.now() + 60 * 60 * 1000);
    await saleService.recordSale(tenantId, randomUUID(), { lineItems: [{ description: "Real sale", quantity: 1, unitPrice: 100 }] });

    // Breaches: real sales total (100) is below this threshold.
    await kpiBenchmarkService.setBenchmark(tenantId, randomUUID(), "sales_amount", "below", 5000, periodStart, periodEnd);
    // Does not breach: real sales total (100) is not below this threshold.
    await kpiBenchmarkService.setBenchmark(tenantId, randomUUID(), "sales_amount", "below", 10, periodStart, periodEnd);

    const breaches = await checkService.checkAllTenants();
    expect(breaches).toBe(1);
  });
});

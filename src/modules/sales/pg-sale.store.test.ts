import { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { CatalogService } from "../catalog/catalog-item.service";
import { PgCatalogItemStore } from "../catalog/pg-catalog-item.store";
import { DealService } from "../deals/deal.service";
import { PgDealStore } from "../deals/pg-deal.store";
import { RatingService } from "../reputation/rating.service";
import { PgRatingStore } from "../reputation/pg-rating.store";
import { NpsService } from "../growth-audit/nps.service";
import { PgNpsResponseStore } from "../growth-audit/pg-nps-response.store";
import { SaleService } from "./sale.service";
import { PgSaleStore } from "./pg-sale.store";
import { runWithTenantContext } from "../../common/postgres";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const maybeDescribe = TEST_DATABASE_URL ? describe : describe.skip;

maybeDescribe("PgSaleStore + SaleService against a real PostgreSQL instance", () => {
  const pool = new Pool({ connectionString: TEST_DATABASE_URL });
  const catalogService = new CatalogService(new PgCatalogItemStore(pool));
  const dealService = new DealService(new PgDealStore(pool), catalogService);
  const ratingService = new RatingService(new PgRatingStore(pool));
  const npsService = new NpsService(new PgNpsResponseStore(pool));
  const saleService = new SaleService(new PgSaleStore(pool), dealService, ratingService, npsService);
  const tenantId = randomUUID();

  beforeAll(async () => {
    await pool.query("insert into tenant (id, name) values ($1, 'PgSaleStore test tenant')", [tenantId]);
  });

  afterAll(async () => {
    await runWithTenantContext(pool, tenantId, (client) => client.query("delete from tenant where id = $1", [tenantId]));
    await pool.end();
  });

  test("recordSale persists a real transaction and its real line items, discount applied from a real deal", async () => {
    const item = await catalogService.create(tenantId, randomUUID(), "Haircut", "service", 100);
    const deal = await dealService.create(tenantId, randomUUID(), { name: "20% off haircuts", discountType: "percentage_off", percentageOff: 20, catalogItemIds: [item.id] });

    const sale = await saleService.recordSale(tenantId, randomUUID(), { dealId: deal.id, lineItems: [{ catalogItemId: item.id, quantity: 1, unitPrice: 100 }] });
    expect(sale.discountAmount).toBe(20);
    expect(sale.totalAmount).toBe(80);

    const list = await saleService.listForTenant(tenantId);
    const found = list.find((s) => s.id === sale.id);
    expect(found?.lineItems).toHaveLength(1);
    expect(found?.lineItems[0].catalogItemId).toBe(item.id);
  });

  test("computeKpis genuinely aggregates real rows, including a real conversion-rate cross-module join", async () => {
    const customerId = randomUUID();
    await runWithTenantContext(pool, tenantId, (client) =>
      client.query("insert into customer (id, tenant_id, display_name) values ($1, $2, 'KPI test customer')", [customerId, tenantId])
    );
    const periodStart = new Date(Date.now() - 60 * 60 * 1000);
    const periodEnd = new Date(Date.now() + 60 * 60 * 1000);

    await ratingService.submit(tenantId, customerId, 5, randomUUID());
    await saleService.recordSale(tenantId, randomUUID(), { customerId, lineItems: [{ description: "Real sale", quantity: 2, unitPrice: 50 }] });

    const kpis = await saleService.computeKpis(tenantId, periodStart, periodEnd);
    expect(kpis.transactionalVolume).toBeGreaterThanOrEqual(1);
    expect(kpis.conversionRate).toBe(100); // the one engaged customer in-period also bought
  });

  test("listForTenant is tenant-scoped, enforced by RLS", async () => {
    const otherTenantId = randomUUID();
    await pool.query("insert into tenant (id, name) values ($1, 'other tenant')", [otherTenantId]);
    await saleService.recordSale(otherTenantId, randomUUID(), { lineItems: [{ description: "Other tenant's sale", quantity: 1, unitPrice: 9999 }] });

    const list = await saleService.listForTenant(tenantId);
    expect(list.every((s) => s.tenantId === tenantId)).toBe(true);

    await runWithTenantContext(pool, otherTenantId, (client) => client.query("delete from tenant where id = $1", [otherTenantId]));
  });

  test("listPageForTenant runs a real limit/offset query against Postgres and a real count(*) for total, added 2026-09-11", async () => {
    const pageTenantId = randomUUID();
    await pool.query("insert into tenant (id, name) values ($1, 'pagination test tenant')", [pageTenantId]);
    for (let i = 1; i <= 5; i++) {
      await saleService.recordSale(pageTenantId, randomUUID(), {
        occurredAt: new Date(Date.now() - (5 - i) * 60 * 60 * 1000),
        lineItems: [{ description: `Item ${i}`, quantity: 1, unitPrice: i * 10 }],
      });
    }

    const page = await saleService.listPageForTenant(pageTenantId, undefined, undefined, 2, 2);
    expect(page.total).toBe(5);
    expect(page.items).toHaveLength(2);
    expect(page.items.map((s) => s.totalAmount)).toEqual([30, 40]);

    await runWithTenantContext(pool, pageTenantId, (client) => client.query("delete from tenant where id = $1", [pageTenantId]));
  });
});

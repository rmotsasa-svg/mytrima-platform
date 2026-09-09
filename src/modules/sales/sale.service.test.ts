import { SaleService, InvalidSaleError } from "./sale.service";
import { InMemorySaleStore } from "./in-memory-sale.store";
import { DealService } from "../deals/deal.service";
import { InMemoryDealStore } from "../deals/in-memory-deal.store";
import { CatalogService } from "../catalog/catalog-item.service";
import { InMemoryCatalogItemStore } from "../catalog/in-memory-catalog-item.store";
import { RatingService } from "../reputation/rating.service";
import { InMemoryRatingStore } from "../reputation/in-memory-rating.store";
import { NpsService } from "../growth-audit/nps.service";
import { InMemoryNpsResponseStore } from "../growth-audit/in-memory-nps-response.store";

function makeServices() {
  const catalogService = new CatalogService(new InMemoryCatalogItemStore());
  const dealService = new DealService(new InMemoryDealStore(), catalogService);
  const ratingService = new RatingService(new InMemoryRatingStore());
  const npsService = new NpsService(new InMemoryNpsResponseStore());
  const saleService = new SaleService(new InMemorySaleStore(), dealService, ratingService, npsService);
  return { catalogService, dealService, ratingService, npsService, saleService };
}

test("recordSale computes subtotal and total with no deal", async () => {
  const { saleService } = makeServices();
  const sale = await saleService.recordSale("t1", "s1", { lineItems: [{ description: "Haircut", quantity: 1, unitPrice: 150 }] });
  expect(sale.subtotalAmount).toBe(150);
  expect(sale.discountAmount).toBe(0);
  expect(sale.totalAmount).toBe(150);
});

test("recordSale rejects an empty lineItems list", async () => {
  const { saleService } = makeServices();
  await expect(saleService.recordSale("t1", "s1", { lineItems: [] })).rejects.toThrow(InvalidSaleError);
});

test("recordSale rejects a line item with neither catalogItemId nor description", async () => {
  const { saleService } = makeServices();
  await expect(saleService.recordSale("t1", "s1", { lineItems: [{ quantity: 1, unitPrice: 10 }] })).rejects.toThrow(InvalidSaleError);
});

test("recordSale applies a percentage_off deal to the matching line item only", async () => {
  const { catalogService, dealService, saleService } = makeServices();
  const item = await catalogService.create("t1", "i1", "Haircut", "service", 100);
  const deal = await dealService.create("t1", "d1", { name: "20% off haircuts", discountType: "percentage_off", percentageOff: 20, catalogItemIds: [item.id] });

  const sale = await saleService.recordSale("t1", "s1", {
    dealId: deal.id,
    lineItems: [
      { catalogItemId: item.id, quantity: 1, unitPrice: 100 },
      { description: "Unrelated add-on", quantity: 1, unitPrice: 50 },
    ],
  });
  expect(sale.subtotalAmount).toBe(150);
  expect(sale.discountAmount).toBe(20); // only the haircut line is discounted
  expect(sale.totalAmount).toBe(130);
});

test("recordSale rejects an unknown dealId", async () => {
  const { saleService } = makeServices();
  await expect(saleService.recordSale("t1", "s1", { dealId: "no-such-deal", lineItems: [{ description: "X", quantity: 1, unitPrice: 10 }] })).rejects.toThrow(InvalidSaleError);
});

test("computeKpis: transactionalVolume, salesAmount, averageTransactionValue, unitsPerTransaction", async () => {
  const { saleService } = makeServices();
  const periodStart = new Date("2026-01-01");
  const periodEnd = new Date("2026-01-31");
  await saleService.recordSale("t1", "s1", { occurredAt: new Date("2026-01-10"), lineItems: [{ description: "A", quantity: 2, unitPrice: 50 }] });
  await saleService.recordSale("t1", "s2", { occurredAt: new Date("2026-01-15"), lineItems: [{ description: "B", quantity: 1, unitPrice: 200 }] });

  const kpis = await saleService.computeKpis("t1", periodStart, periodEnd);
  expect(kpis.transactionalVolume).toBe(2);
  expect(kpis.salesAmount).toBe(300);
  expect(kpis.averageTransactionValue).toBe(150);
  expect(kpis.unitsPerTransaction).toBe(1.5);
});

test("computeKpis: addonRate is the % of transactions with at least one addon line item", async () => {
  const { saleService } = makeServices();
  const periodStart = new Date("2026-01-01");
  const periodEnd = new Date("2026-01-31");
  await saleService.recordSale("t1", "s1", {
    occurredAt: new Date("2026-01-10"),
    lineItems: [
      { description: "Main", quantity: 1, unitPrice: 100 },
      { description: "Addon", quantity: 1, unitPrice: 10, isAddon: true },
    ],
  });
  await saleService.recordSale("t1", "s2", { occurredAt: new Date("2026-01-15"), lineItems: [{ description: "Main only", quantity: 1, unitPrice: 100 }] });

  const kpis = await saleService.computeKpis("t1", periodStart, periodEnd);
  expect(kpis.addonRate).toBe(50);
});

test("computeKpis: conversionRate is null when no customer has a Rating/NPS response in the period", async () => {
  const { saleService } = makeServices();
  const kpis = await saleService.computeKpis("t1", new Date("2026-01-01"), new Date("2026-01-31"));
  expect(kpis.conversionRate).toBeNull();
});

test("computeKpis: conversionRate counts engaged customers who also bought", async () => {
  const { ratingService, npsService, saleService } = makeServices();
  // Real bug found running this: RatingService.submit()/NpsService.submit()
  // always stamp submittedAt as the real "now" — there is no way to backdate
  // it — so a fixed past period (e.g. January 2026) never actually contains
  // either submission, and conversionRate correctly (if unhelpfully, for
  // this test) comes back null. The period has to span the real current
  // time instead.
  const periodStart = new Date(Date.now() - 60 * 60 * 1000);
  const periodEnd = new Date(Date.now() + 60 * 60 * 1000);

  await ratingService.submit("t1", "customer-a", 5, "r1"); // engaged, will also buy
  await npsService.submit("t1", "customer-b", 9, "n1"); // engaged, will NOT buy
  await saleService.recordSale("t1", "s1", { customerId: "customer-a", lineItems: [{ description: "X", quantity: 1, unitPrice: 10 }] });

  const kpis = await saleService.computeKpis("t1", periodStart, periodEnd);
  expect(kpis.conversionRate).toBe(50); // 1 of 2 engaged customers bought
});

test("computeKpis is tenant-scoped", async () => {
  const { saleService } = makeServices();
  await saleService.recordSale("t1", "s1", { occurredAt: new Date("2026-01-10"), lineItems: [{ description: "X", quantity: 1, unitPrice: 100 }] });
  await saleService.recordSale("t2", "s2", { occurredAt: new Date("2026-01-10"), lineItems: [{ description: "Y", quantity: 1, unitPrice: 9999 }] });

  const kpis = await saleService.computeKpis("t1", new Date("2026-01-01"), new Date("2026-01-31"));
  expect(kpis.salesAmount).toBe(100);
});

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
  expect(kpis.totalUnits).toBe(3);
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

/**
 * Added 2026-09-10, sourced from the user-provided "Essential Growth
 * Strategy KPIs" reference doc — see sale.service.ts's own comment for
 * exactly what was cited and what wasn't invented.
 */
test("computeKpis: churnRate — a start-of-period customer who doesn't buy again in the period counts as lost", async () => {
  const { saleService } = makeServices();
  const periodStart = new Date("2026-01-01");
  const periodEnd = new Date("2026-01-31");

  // Customer A: bought before the period AND during it -> retained.
  await saleService.recordSale("t1", "s1", { customerId: "customer-a", occurredAt: new Date("2025-12-15"), lineItems: [{ description: "X", quantity: 1, unitPrice: 50 }] });
  await saleService.recordSale("t1", "s2", { customerId: "customer-a", occurredAt: new Date("2026-01-10"), lineItems: [{ description: "X", quantity: 1, unitPrice: 50 }] });
  // Customer B: bought before the period, NOT during it -> lost.
  await saleService.recordSale("t1", "s3", { customerId: "customer-b", occurredAt: new Date("2025-12-20"), lineItems: [{ description: "X", quantity: 1, unitPrice: 50 }] });
  // Customer C: only ever bought during the period -> not part of the start-of-period cohort at all.
  await saleService.recordSale("t1", "s4", { customerId: "customer-c", occurredAt: new Date("2026-01-05"), lineItems: [{ description: "X", quantity: 1, unitPrice: 50 }] });

  const kpis = await saleService.computeKpis("t1", periodStart, periodEnd);
  expect(kpis.churnRate).toBe(50); // 1 of 2 start-of-period customers (A, B) was lost
});

test("computeKpis: churnRate is null when there were no start-of-period customers to compute a rate over", async () => {
  const { saleService } = makeServices();
  await saleService.recordSale("t1", "s1", { customerId: "customer-a", occurredAt: new Date("2026-01-05"), lineItems: [{ description: "X", quantity: 1, unitPrice: 50 }] });
  const kpis = await saleService.computeKpis("t1", new Date("2026-01-01"), new Date("2026-01-31"));
  expect(kpis.churnRate).toBeNull();
});

describe("computeLifetimeValue", () => {
  test("returns null when the tenant has no sales at all", async () => {
    const { saleService } = makeServices();
    expect(await saleService.computeLifetimeValue("t1")).toBeNull();
  });

  test("returns null when no sale has a named customerId (walk-in/cash sales only)", async () => {
    const { saleService } = makeServices();
    await saleService.recordSale("t1", "s1", { lineItems: [{ description: "X", quantity: 1, unitPrice: 100 }] });
    expect(await saleService.computeLifetimeValue("t1")).toBeNull();
  });

  test("returns null when no customer has a repeat purchase yet — a lifespan genuinely can't be observed", async () => {
    const { saleService } = makeServices();
    await saleService.recordSale("t1", "s1", { customerId: "customer-a", lineItems: [{ description: "X", quantity: 1, unitPrice: 100 }] });
    expect(await saleService.computeLifetimeValue("t1")).toBeNull();
  });

  test("hand-calculable example: one repeat customer, purchases exactly 1 year apart, first purchase exactly 2 years ago", async () => {
    const { saleService } = makeServices();
    const msPerDay = 24 * 60 * 60 * 1000;
    const twoYearsAgo = new Date(Date.now() - 730 * msPerDay);
    const oneYearAgo = new Date(Date.now() - 365 * msPerDay);

    await saleService.recordSale("t1", "s1", { customerId: "customer-a", occurredAt: twoYearsAgo, lineItems: [{ description: "X", quantity: 1, unitPrice: 100 }] });
    await saleService.recordSale("t1", "s2", { customerId: "customer-a", occurredAt: oneYearAgo, lineItems: [{ description: "X", quantity: 1, unitPrice: 100 }] });

    const result = await saleService.computeLifetimeValue("t1");
    // averageOrderValue = 200/2 = 100. customerAgeYears ~= 2 (now - first purchase).
    // purchasesPerCustomer = 2/1 = 2, purchaseFrequencyPerYear = 2/2 = 1.
    // customerLifespanYears = (oneYearAgo - twoYearsAgo) ~= 1.
    // lifetimeValue = 100 * 1 * 1 = 100.
    expect(result?.averageOrderValue).toBe(100);
    expect(result?.purchaseFrequencyPerYear).toBeCloseTo(1, 1);
    expect(result?.customerLifespanYears).toBeCloseTo(1, 1);
    expect(result?.lifetimeValue).toBeCloseTo(100, 0);
  });

  test("is tenant-scoped", async () => {
    const { saleService } = makeServices();
    await saleService.recordSale("t1", "s1", { customerId: "customer-a", lineItems: [{ description: "X", quantity: 1, unitPrice: 100 }] });
    await saleService.recordSale("t2", "s2", { customerId: "customer-b", lineItems: [{ description: "Y", quantity: 1, unitPrice: 9999 }] });
    // t1 has no repeat customer, so its own result is null — proves t2's
    // data isn't leaking in (which would otherwise change the outcome).
    expect(await saleService.computeLifetimeValue("t1")).toBeNull();
  });
});

/**
 * Added 2026-09-10, prompted by a real reference report the user supplied
 * that treated "new customer comes back for a second visit" as the single
 * biggest revenue lever — a distinct metric from churnRate (existing
 * customers lapsing), not a duplicate of it.
 */
describe("computeRepeatRate", () => {
  test("repeatRate is null when no new customer's first purchase falls in the period", async () => {
    const { saleService } = makeServices();
    const result = await saleService.computeRepeatRate("t1", new Date("2026-01-01"), new Date("2026-01-31"));
    expect(result.newCustomerCount).toBe(0);
    expect(result.repeatRate).toBeNull();
  });

  test("a new customer who never returns counts against the rate, one who does counts for it", async () => {
    const { saleService } = makeServices();
    const periodStart = new Date("2026-01-01");
    const periodEnd = new Date("2026-01-31");

    // Customer A: first purchase in the period, never returns.
    await saleService.recordSale("t1", "s1", { customerId: "customer-a", occurredAt: new Date("2026-01-05"), lineItems: [{ description: "X", quantity: 1, unitPrice: 50 }] });
    // Customer B: first purchase in the period, returns later (outside the period — no fixed window).
    await saleService.recordSale("t1", "s2", { customerId: "customer-b", occurredAt: new Date("2026-01-10"), lineItems: [{ description: "X", quantity: 1, unitPrice: 50 }] });
    await saleService.recordSale("t1", "s3", { customerId: "customer-b", occurredAt: new Date("2026-03-01"), lineItems: [{ description: "X", quantity: 1, unitPrice: 50 }] });

    const result = await saleService.computeRepeatRate("t1", periodStart, periodEnd);
    expect(result.newCustomerCount).toBe(2);
    expect(result.repeatCustomerCount).toBe(1);
    expect(result.repeatRate).toBe(50);
  });

  test("a customer whose first-ever purchase is BEFORE the period doesn't count as a new customer, even if they buy again during it", async () => {
    const { saleService } = makeServices();
    await saleService.recordSale("t1", "s1", { customerId: "customer-a", occurredAt: new Date("2025-12-01"), lineItems: [{ description: "X", quantity: 1, unitPrice: 50 }] });
    await saleService.recordSale("t1", "s2", { customerId: "customer-a", occurredAt: new Date("2026-01-15"), lineItems: [{ description: "X", quantity: 1, unitPrice: 50 }] });

    const result = await saleService.computeRepeatRate("t1", new Date("2026-01-01"), new Date("2026-01-31"));
    expect(result.newCustomerCount).toBe(0);
  });

  test("is tenant-scoped", async () => {
    const { saleService } = makeServices();
    await saleService.recordSale("t1", "s1", { customerId: "customer-a", occurredAt: new Date("2026-01-05"), lineItems: [{ description: "X", quantity: 1, unitPrice: 50 }] });
    await saleService.recordSale("t2", "s2", { customerId: "customer-b", occurredAt: new Date("2026-01-05"), lineItems: [{ description: "Y", quantity: 1, unitPrice: 9999 }] });
    await saleService.recordSale("t2", "s3", { customerId: "customer-b", occurredAt: new Date("2026-01-20"), lineItems: [{ description: "Y", quantity: 1, unitPrice: 9999 }] });

    const result = await saleService.computeRepeatRate("t1", new Date("2026-01-01"), new Date("2026-01-31"));
    expect(result.newCustomerCount).toBe(1);
    expect(result.repeatRate).toBe(0); // t2's repeat customer doesn't leak into t1
  });
});

test("computeKpis is tenant-scoped", async () => {
  const { saleService } = makeServices();
  await saleService.recordSale("t1", "s1", { occurredAt: new Date("2026-01-10"), lineItems: [{ description: "X", quantity: 1, unitPrice: 100 }] });
  await saleService.recordSale("t2", "s2", { occurredAt: new Date("2026-01-10"), lineItems: [{ description: "Y", quantity: 1, unitPrice: 9999 }] });

  const kpis = await saleService.computeKpis("t1", new Date("2026-01-01"), new Date("2026-01-31"));
  expect(kpis.salesAmount).toBe(100);
});

import { RetentionService } from "./retention.service";
import { SaleService } from "../sales/sale.service";
import { InMemorySaleStore } from "../sales/in-memory-sale.store";
import { DealService } from "../deals/deal.service";
import { InMemoryDealStore } from "../deals/in-memory-deal.store";
import { CatalogService } from "../catalog/catalog-item.service";
import { InMemoryCatalogItemStore } from "../catalog/in-memory-catalog-item.store";
import { RatingService } from "../reputation/rating.service";
import { InMemoryRatingStore } from "../reputation/in-memory-rating.store";
import { NpsService } from "../growth-audit/nps.service";
import { InMemoryNpsResponseStore } from "../growth-audit/in-memory-nps-response.store";
import { CustomerService } from "../customers/customer.service";
import { InMemoryCustomerStore } from "../customers/in-memory-customer.store";
import { ConsentService } from "../compliance/consent.service";
import { InMemoryConsentStore } from "../compliance/in-memory-consent.store";

const NOW = new Date("2026-09-14T12:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1000;
const daysAgo = (n: number) => new Date(NOW.getTime() - n * DAY_MS);

function makeServices() {
  const catalogService = new CatalogService(new InMemoryCatalogItemStore());
  const dealService = new DealService(new InMemoryDealStore(), catalogService);
  const ratingService = new RatingService(new InMemoryRatingStore());
  const npsService = new NpsService(new InMemoryNpsResponseStore());
  const saleService = new SaleService(new InMemorySaleStore(), dealService, ratingService, npsService, catalogService);
  const customerService = new CustomerService(new InMemoryCustomerStore(), ratingService, new ConsentService(new InMemoryConsentStore()));
  const retentionService = new RetentionService(saleService, customerService);
  return { retentionService, saleService, customerService };
}

async function recordSale(saleService: SaleService, tenantId: string, id: string, customerId: string, occurredAt: Date) {
  await saleService.recordSale(tenantId, id, { customerId, occurredAt, lineItems: [{ description: "Item", quantity: 1, unitPrice: 50 }] });
}

test("a customer with no purchases in over 90 days is inactive, not at-risk", async () => {
  const { retentionService, saleService, customerService } = makeServices();
  const customer = await customerService.create("t1", "c1", "Palesa", "+26650000002");
  await recordSale(saleService, "t1", "s1", customer.id, daysAgo(120));

  const summary = await retentionService.retentionSummary("t1", NOW);
  expect(summary.atRisk).toHaveLength(0);
  expect(summary.inactive).toHaveLength(1);
  expect(summary.inactive[0].customerId).toBe(customer.id);
  expect(summary.inactive[0].daysSinceLastPurchase).toBe(120);
});

test("a customer at exactly the 60-day threshold is at-risk, not inactive", async () => {
  const { retentionService, saleService, customerService } = makeServices();
  const customer = await customerService.create("t1", "c1", "Palesa", "+26650000002");
  await recordSale(saleService, "t1", "s1", customer.id, daysAgo(60));

  const summary = await retentionService.retentionSummary("t1", NOW);
  expect(summary.atRisk).toHaveLength(1);
  expect(summary.inactive).toHaveLength(0);
});

test("a customer who bought 10 days ago is neither at-risk nor inactive", async () => {
  const { retentionService, saleService, customerService } = makeServices();
  const customer = await customerService.create("t1", "c1", "Palesa", "+26650000002");
  await recordSale(saleService, "t1", "s1", customer.id, daysAgo(10));

  const summary = await retentionService.retentionSummary("t1", NOW);
  expect(summary.atRisk).toHaveLength(0);
  expect(summary.inactive).toHaveLength(0);
});

test("reactivationCandidates is the subset of inactive customers with 2+ historical purchases", async () => {
  const { retentionService, saleService, customerService } = makeServices();
  const repeatCustomer = await customerService.create("t1", "c1", "Palesa (repeat)", "+26650000002");
  await recordSale(saleService, "t1", "s1", repeatCustomer.id, daysAgo(200));
  await recordSale(saleService, "t1", "s2", repeatCustomer.id, daysAgo(120));

  const oneTimeCustomer = await customerService.create("t1", "c2", "Once-off customer", "+26650000003");
  await recordSale(saleService, "t1", "s3", oneTimeCustomer.id, daysAgo(120));

  const summary = await retentionService.retentionSummary("t1", NOW);
  expect(summary.inactive).toHaveLength(2);
  expect(summary.reactivationCandidates).toHaveLength(1);
  expect(summary.reactivationCandidates[0].customerId).toBe(repeatCustomer.id);
  expect(summary.reactivationCandidates[0].totalPurchases).toBe(2);
  // lastPurchaseAt is the MOST RECENT of the repeat customer's purchases.
  expect(summary.reactivationCandidates[0].daysSinceLastPurchase).toBe(120);
});

test("a walk-in sale with no customerId contributes nothing to retention", async () => {
  const { retentionService, saleService } = makeServices();
  await saleService.recordSale("t1", "s1", { occurredAt: daysAgo(120), lineItems: [{ description: "Item", quantity: 1, unitPrice: 50 }] });

  const summary = await retentionService.retentionSummary("t1", NOW);
  expect(summary.atRisk).toHaveLength(0);
  expect(summary.inactive).toHaveLength(0);
});

test("retentionSummary never crosses tenants", async () => {
  const { retentionService, saleService, customerService } = makeServices();
  const c1 = await customerService.create("t1", "c1", "Palesa", "+26650000002");
  await recordSale(saleService, "t1", "s1", c1.id, daysAgo(120));
  const c2 = await customerService.create("t2", "c2", "Other tenant", "+26650000009");
  await recordSale(saleService, "t2", "s2", c2.id, daysAgo(120));

  const summary = await retentionService.retentionSummary("t1", NOW);
  expect(summary.inactive).toHaveLength(1);
  expect(summary.inactive[0].customerId).toBe(c1.id);
});

test("repeatRate is SaleService's own real computeRepeatRate() result, not recomputed", async () => {
  const { retentionService, saleService, customerService } = makeServices();
  const customer = await customerService.create("t1", "c1", "Palesa", "+26650000002");
  await recordSale(saleService, "t1", "s1", customer.id, daysAgo(80));
  await recordSale(saleService, "t1", "s2", customer.id, daysAgo(10));

  const summary = await retentionService.retentionSummary("t1", NOW);
  const expected = await saleService.computeRepeatRate("t1", new Date(NOW.getTime() - 90 * DAY_MS), NOW);
  expect(summary.repeatRate).toEqual(expected);
});

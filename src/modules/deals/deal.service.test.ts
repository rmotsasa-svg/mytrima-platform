import { DealService, InvalidDealError, DealNotFoundError, Deal } from "./deal.service";
import { InMemoryDealStore } from "./in-memory-deal.store";
import { CatalogService } from "../catalog/catalog-item.service";
import { InMemoryCatalogItemStore } from "../catalog/in-memory-catalog-item.store";

function baseDeal(overrides: Partial<Deal>): Deal {
  return { id: "d1", tenantId: "t1", name: "Test deal", discountType: "percentage_off", isActive: true, catalogItemIds: ["i1"], createdAt: new Date(), ...overrides };
}

function makeServices() {
  const catalogService = new CatalogService(new InMemoryCatalogItemStore());
  const dealService = new DealService(new InMemoryDealStore(), catalogService);
  return { catalogService, dealService };
}

test("create persists a percentage_off deal", async () => {
  const { catalogService, dealService } = makeServices();
  const item = await catalogService.create("t1", "i1", "Haircut", "service", 150);
  const deal = await dealService.create("t1", "d1", { name: "20% off haircuts", discountType: "percentage_off", percentageOff: 20, catalogItemIds: [item.id] });
  expect(deal.percentageOff).toBe(20);
  expect(deal.catalogItemIds).toEqual([item.id]);
});

test("create rejects percentage_off without a valid percentageOff", async () => {
  const { catalogService, dealService } = makeServices();
  const item = await catalogService.create("t1", "i1", "Widget", "product", 10);
  await expect(dealService.create("t1", "d1", { name: "Bad deal", discountType: "percentage_off", catalogItemIds: [item.id] })).rejects.toThrow(InvalidDealError);
});

test("create rejects buy_x_get_y_free without buyQuantity/freeQuantity", async () => {
  const { catalogService, dealService } = makeServices();
  const item = await catalogService.create("t1", "i1", "Widget", "product", 10);
  await expect(dealService.create("t1", "d1", { name: "Bad deal", discountType: "buy_x_get_y_free", catalogItemIds: [item.id] })).rejects.toThrow(InvalidDealError);
});

test("create rejects a catalog item id from a different tenant", async () => {
  const { catalogService, dealService } = makeServices();
  const item = await catalogService.create("t2", "i1", "Other tenant's item", "product", 10);
  await expect(
    dealService.create("t1", "d1", { name: "Deal", discountType: "fixed_amount_off", fixedAmountOff: 5, catalogItemIds: [item.id] })
  ).rejects.toThrow(InvalidDealError);
});

test("create rejects an empty catalogItemIds list", async () => {
  const { dealService } = makeServices();
  await expect(dealService.create("t1", "d1", { name: "Deal", discountType: "fixed_amount_off", fixedAmountOff: 5, catalogItemIds: [] })).rejects.toThrow(InvalidDealError);
});

test("computeDiscount: percentage_off computes the correct amount", () => {
  const { dealService } = makeServices();
  const deal = baseDeal({ discountType: "percentage_off", percentageOff: 20 });
  expect(dealService.computeDiscount(deal, 1, 100, 100)).toBe(20);
});

test("computeDiscount: buy 2 get 1 free gives one free unit per group of 3", () => {
  const { dealService } = makeServices();
  const deal = baseDeal({ discountType: "buy_x_get_y_free", buyQuantity: 2, freeQuantity: 1 });
  // 6 units at unitPrice 10 -> 2 full groups of 3 -> 2 free units -> 20 off
  expect(dealService.computeDiscount(deal, 6, 60, 10)).toBe(20);
});

test("computeDiscount: buy 1 get 1 free gives one free unit per pair", () => {
  const { dealService } = makeServices();
  const deal = baseDeal({ discountType: "buy_x_get_y_free", buyQuantity: 1, freeQuantity: 1 });
  // 4 units at unitPrice 10 -> 2 groups of 2 -> 2 free units -> 20 off
  expect(dealService.computeDiscount(deal, 4, 40, 10)).toBe(20);
});

test("computeDiscount: fixed_amount_off never exceeds the line subtotal", () => {
  const { dealService } = makeServices();
  const deal = baseDeal({ discountType: "fixed_amount_off", fixedAmountOff: 500 });
  expect(dealService.computeDiscount(deal, 1, 50, 50)).toBe(50);
});

test("setAdImage sets a real adImageUrl without touching any other field", async () => {
  const { catalogService, dealService } = makeServices();
  const item = await catalogService.create("t1", "i1", "Haircut", "service", 150);
  const deal = await dealService.create("t1", "d1", { name: "20% off haircuts", discountType: "percentage_off", percentageOff: 20, catalogItemIds: [item.id] });
  const updated = await dealService.setAdImage("t1", deal.id, "/uploads/deals/t1/abc123.png");
  expect(updated.adImageUrl).toBe("/uploads/deals/t1/abc123.png");
  expect(updated.name).toBe("20% off haircuts");
  expect(updated.percentageOff).toBe(20);
});

test("setAdImage throws DealNotFoundError for a wrong tenant or unknown id", async () => {
  const { catalogService, dealService } = makeServices();
  const item = await catalogService.create("t1", "i1", "Haircut", "service", 150);
  const deal = await dealService.create("t1", "d1", { name: "Deal", discountType: "percentage_off", percentageOff: 10, catalogItemIds: [item.id] });
  await expect(dealService.setAdImage("t2", deal.id, "/x.png")).rejects.toThrow(DealNotFoundError);
  await expect(dealService.setAdImage("t1", "unknown", "/x.png")).rejects.toThrow(DealNotFoundError);
});

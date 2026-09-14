import { ShiftBankingService, InvalidShiftBankingError } from "./shift-banking.service";
import { InMemoryShiftBankingStore } from "./in-memory-shift-banking.store";
import { RefundService } from "./refund.service";
import { InMemoryRefundStore } from "./in-memory-refund.store";
import { SaleService } from "./sale.service";
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
  const saleService = new SaleService(new InMemorySaleStore(), dealService, ratingService, npsService, catalogService);
  const refundService = new RefundService(new InMemoryRefundStore(), saleService);
  const shiftBankingStore = new InMemoryShiftBankingStore();
  const shiftBankingService = new ShiftBankingService(shiftBankingStore, saleService, refundService);
  return { saleService, refundService, shiftBankingService, shiftBankingStore };
}

const PERIOD_START = new Date("2026-09-14T00:00:00Z");
const PERIOD_END = new Date("2026-09-14T23:59:59.999Z");

test("computeExpectedCash sums only cash-payment-method sales in the period, ignoring card sales", async () => {
  const { saleService, shiftBankingService } = makeServices();
  await saleService.recordSale("t1", "s1", {
    lineItems: [{ description: "Haircut", quantity: 1, unitPrice: 150 }],
    paymentMethod: "cash",
    occurredAt: new Date("2026-09-14T10:00:00Z"),
  });
  await saleService.recordSale("t1", "s2", {
    lineItems: [{ description: "Manicure", quantity: 1, unitPrice: 80 }],
    paymentMethod: "card",
    occurredAt: new Date("2026-09-14T11:00:00Z"),
  });
  const expected = await shiftBankingService.computeExpectedCash("t1", PERIOD_START, PERIOD_END);
  expect(expected).toBe(150);
});

test("a sale with no explicit paymentMethod defaults to cash", async () => {
  const { saleService, shiftBankingService } = makeServices();
  await saleService.recordSale("t1", "s1", {
    lineItems: [{ description: "Haircut", quantity: 1, unitPrice: 150 }],
    occurredAt: new Date("2026-09-14T10:00:00Z"),
  });
  const expected = await shiftBankingService.computeExpectedCash("t1", PERIOD_START, PERIOD_END);
  expect(expected).toBe(150);
});

test("computeExpectedCash nets real refunds against cash sales in the period", async () => {
  const { saleService, refundService, shiftBankingService } = makeServices();
  const sale = await saleService.recordSale("t1", "s1", {
    lineItems: [{ description: "Haircut", quantity: 1, unitPrice: 150 }],
    paymentMethod: "cash",
    occurredAt: new Date("2026-09-14T10:00:00Z"),
  });
  await refundService.recordRefund("t1", "r1", sale.id, [{ description: "Haircut", quantity: 1, unitPrice: 150 }], "Not satisfied");
  const expected = await shiftBankingService.computeExpectedCash("t1", PERIOD_START, PERIOD_END);
  expect(expected).toBe(0);
});

test("closeShift snapshots expectedCashAmount from real sales at close time", async () => {
  const { saleService, shiftBankingService } = makeServices();
  await saleService.recordSale("t1", "s1", {
    lineItems: [{ description: "Haircut", quantity: 1, unitPrice: 300 }],
    paymentMethod: "cash",
    occurredAt: new Date("2026-09-14T10:00:00Z"),
  });
  const record = await shiftBankingService.closeShift("t1", "shift1", PERIOD_START, PERIOD_END, 300, 300, "End of day", "u1");
  expect(record.expectedCashAmount).toBe(300);
  expect(record.countedCashAmount).toBe(300);
  expect(record.bankedAmount).toBe(300);
  expect(shiftBankingService.variance(record)).toBe(0);
});

test("variance is real and honest when the count doesn't match the books", async () => {
  const { saleService, shiftBankingService } = makeServices();
  await saleService.recordSale("t1", "s1", {
    lineItems: [{ description: "Haircut", quantity: 1, unitPrice: 300 }],
    paymentMethod: "cash",
    occurredAt: new Date("2026-09-14T10:00:00Z"),
  });
  const short = await shiftBankingService.closeShift("t1", "shift1", PERIOD_START, PERIOD_END, 250, 250);
  expect(shiftBankingService.variance(short)).toBe(-50);

  const over = await shiftBankingService.closeShift("t1", "shift2", PERIOD_START, PERIOD_END, 320, 320);
  expect(shiftBankingService.variance(over)).toBe(20);
});

test("closeShift rejects a negative counted or banked amount", async () => {
  const { shiftBankingService } = makeServices();
  await expect(shiftBankingService.closeShift("t1", "shift1", PERIOD_START, PERIOD_END, -10, 0)).rejects.toThrow(InvalidShiftBankingError);
  await expect(shiftBankingService.closeShift("t1", "shift1", PERIOD_START, PERIOD_END, 0, -10)).rejects.toThrow(InvalidShiftBankingError);
});

test("closeShift rejects a periodEnd at or before periodStart", async () => {
  const { shiftBankingService } = makeServices();
  await expect(shiftBankingService.closeShift("t1", "shift1", PERIOD_END, PERIOD_START, 0, 0)).rejects.toThrow(InvalidShiftBankingError);
});

test("listForTenant returns only this tenant's own records, newest first", async () => {
  const { shiftBankingService, shiftBankingStore } = makeServices();
  await shiftBankingStore.save({
    id: "older",
    tenantId: "t1",
    periodStart: PERIOD_START,
    periodEnd: PERIOD_END,
    expectedCashAmount: 100,
    countedCashAmount: 100,
    bankedAmount: 100,
    createdAt: new Date("2026-09-10T00:00:00Z"),
  });
  await shiftBankingStore.save({
    id: "other-tenant",
    tenantId: "t2",
    periodStart: PERIOD_START,
    periodEnd: PERIOD_END,
    expectedCashAmount: 999,
    countedCashAmount: 999,
    bankedAmount: 999,
    createdAt: new Date("2026-09-12T00:00:00Z"),
  });
  await shiftBankingStore.save({
    id: "newer",
    tenantId: "t1",
    periodStart: PERIOD_START,
    periodEnd: PERIOD_END,
    expectedCashAmount: 200,
    countedCashAmount: 200,
    bankedAmount: 200,
    createdAt: new Date("2026-09-14T00:00:00Z"),
  });
  const records = await shiftBankingService.listForTenant("t1");
  expect(records.map((r) => r.id)).toEqual(["newer", "older"]);
});

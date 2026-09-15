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
  // Real bug found running this the day after it was written: RefundService
  // .recordRefund() always stamps createdAt as real "now" (there's no way
  // to backdate it — same constraint as RatingService.submit()/NpsService
  // .submit(), see sale.service.test.ts's own comment on this exact class
  // of bug), so a fixed past period (PERIOD_START/PERIOD_END above) never
  // actually contains the refund once "now" has moved past that date. The
  // period has to span the real current time instead, just for this test.
  const periodStart = new Date(Date.now() - 60 * 60 * 1000);
  const periodEnd = new Date(Date.now() + 60 * 60 * 1000);
  const sale = await saleService.recordSale("t1", "s1", {
    lineItems: [{ description: "Haircut", quantity: 1, unitPrice: 150 }],
    paymentMethod: "cash",
    occurredAt: new Date(),
  });
  await refundService.recordRefund("t1", "r1", sale.id, [{ description: "Haircut", quantity: 1, unitPrice: 150 }], "Not satisfied");
  const expected = await shiftBankingService.computeExpectedCash("t1", periodStart, periodEnd);
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

test("findById returns the real record for the right tenant only", async () => {
  const { shiftBankingService } = makeServices();
  const record = await shiftBankingService.closeShift("t1", "shift1", PERIOD_START, PERIOD_END, 100, 100);
  expect(await shiftBankingService.findById("t1", record.id)).toEqual(record);
  expect(await shiftBankingService.findById("t2", record.id)).toBeNull();
});

describe("denomination breakdown", () => {
  test("closeShift accepts a real denomination breakdown that sums exactly to countedCashAmount", async () => {
    const { shiftBankingService } = makeServices();
    // 2x50 + 5x10 + 1x0.10x... real notes: 2*50 + 5*10 = 150
    const record = await shiftBankingService.closeShift("t1", "shift1", PERIOD_START, PERIOD_END, 150, 150, undefined, undefined, {
      "50.00": 2,
      "10.00": 5,
    });
    expect(record.denominationCounts).toEqual({ "50.00": 2, "10.00": 5 });
  });

  test("closeShift rejects a breakdown that doesn't actually sum to countedCashAmount", async () => {
    const { shiftBankingService } = makeServices();
    await expect(
      shiftBankingService.closeShift("t1", "shift1", PERIOD_START, PERIOD_END, 200, 200, undefined, undefined, { "50.00": 2 })
    ).rejects.toThrow(InvalidShiftBankingError);
  });

  test("closeShift rejects an unknown denomination key", async () => {
    const { shiftBankingService } = makeServices();
    await expect(
      shiftBankingService.closeShift("t1", "shift1", PERIOD_START, PERIOD_END, 15, 15, undefined, undefined, { "15.00": 1 } as never)
    ).rejects.toThrow(InvalidShiftBankingError);
  });

  test("closeShift rejects a negative or non-integer count", async () => {
    const { shiftBankingService } = makeServices();
    await expect(
      shiftBankingService.closeShift("t1", "shift1", PERIOD_START, PERIOD_END, -10, 0, undefined, undefined, { "10.00": -1 })
    ).rejects.toThrow(InvalidShiftBankingError);
    await expect(
      shiftBankingService.closeShift("t1", "shift1", PERIOD_START, PERIOD_END, 5, 5, undefined, undefined, { "10.00": 0.5 })
    ).rejects.toThrow(InvalidShiftBankingError);
  });

  test("closeShift handles real fractional coin denominations without floating-point false positives", async () => {
    const { shiftBankingService } = makeServices();
    // 0.10 x 3 + 0.20 x 2 + 0.50 x 1 = 0.30 + 0.40 + 0.50 = 1.20 — a real
    // case where naive floating-point addition (0.1 + 0.1 + 0.1 !== 0.3 in
    // IEEE 754) could wrongly reject a correct count.
    const record = await shiftBankingService.closeShift("t1", "shift1", PERIOD_START, PERIOD_END, 1.2, 1.2, undefined, undefined, {
      "0.10": 3,
      "0.20": 2,
      "0.50": 1,
    });
    expect(record.countedCashAmount).toBe(1.2);
  });
});

describe("buildSlipText", () => {
  test("includes every real field, including the denomination breakdown when given", async () => {
    const { shiftBankingService } = makeServices();
    const record = await shiftBankingService.closeShift("t1", "shift1", PERIOD_START, PERIOD_END, 150, 140, "Kept R10 as float", "u1", {
      "50.00": 3,
    });
    const slip = shiftBankingService.buildSlipText(record, "Maseru Spa & Wellness");
    expect(slip).toContain("Maseru Spa & Wellness");
    expect(slip).toContain("Counted cash: 150.00");
    expect(slip).toContain("Banked: 140.00");
    expect(slip).toContain("50.00 x 3 = 150.00");
    expect(slip).toContain("Kept R10 as float");
  });

  test("omits the denomination section entirely when none was given", async () => {
    const { shiftBankingService } = makeServices();
    const record = await shiftBankingService.closeShift("t1", "shift1", PERIOD_START, PERIOD_END, 100, 100);
    const slip = shiftBankingService.buildSlipText(record, "Test Co");
    expect(slip).not.toContain("Denomination breakdown");
  });
});

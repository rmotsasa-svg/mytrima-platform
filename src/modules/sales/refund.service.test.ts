import { RefundService, InvalidRefundError, SaleNotFoundError } from "./refund.service";
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
  return { saleService, refundService, catalogService };
}

test("recordRefund computes a real refundAmount from the given line items", async () => {
  const { saleService, refundService } = makeServices();
  const sale = await saleService.recordSale("t1", "s1", { lineItems: [{ description: "Haircut", quantity: 2, unitPrice: 150 }] });
  const refund = await refundService.recordRefund("t1", "r1", sale.id, [{ description: "Haircut", quantity: 1, unitPrice: 150 }], "Customer unhappy");
  expect(refund.refundAmount).toBe(150);
  expect(refund.reason).toBe("Customer unhappy");
});

test("recordRefund rejects refunding more units than were sold", async () => {
  const { saleService, refundService } = makeServices();
  const sale = await saleService.recordSale("t1", "s1", { lineItems: [{ description: "Haircut", quantity: 2, unitPrice: 150 }] });
  await expect(
    refundService.recordRefund("t1", "r1", sale.id, [{ description: "Haircut", quantity: 3, unitPrice: 150 }])
  ).rejects.toThrow(InvalidRefundError);
});

test("recordRefund rejects refunding the same units twice across two separate refunds", async () => {
  const { saleService, refundService } = makeServices();
  const sale = await saleService.recordSale("t1", "s1", { lineItems: [{ description: "Haircut", quantity: 2, unitPrice: 150 }] });
  await refundService.recordRefund("t1", "r1", sale.id, [{ description: "Haircut", quantity: 2, unitPrice: 150 }]);
  // Every unit is now already refunded — a second refund request for even
  // one more unit must be rejected, not silently accepted.
  await expect(
    refundService.recordRefund("t1", "r2", sale.id, [{ description: "Haircut", quantity: 1, unitPrice: 150 }])
  ).rejects.toThrow(InvalidRefundError);
});

test("recordRefund allows a real partial refund, and tracks the real remaining refundable quantity across two separate refunds", async () => {
  const { saleService, refundService } = makeServices();
  const sale = await saleService.recordSale("t1", "s1", { lineItems: [{ description: "Shampoo", quantity: 3, unitPrice: 40 }] });
  const first = await refundService.recordRefund("t1", "r1", sale.id, [{ description: "Shampoo", quantity: 1, unitPrice: 40 }]);
  expect(first.refundAmount).toBe(40);
  // 2 units remain refundable — refunding 2 more should succeed.
  const second = await refundService.recordRefund("t1", "r2", sale.id, [{ description: "Shampoo", quantity: 2, unitPrice: 40 }]);
  expect(second.refundAmount).toBe(80);
  // Now 0 remain — even 1 more must fail.
  await expect(
    refundService.recordRefund("t1", "r3", sale.id, [{ description: "Shampoo", quantity: 1, unitPrice: 40 }])
  ).rejects.toThrow(InvalidRefundError);
});

test("recordRefund keys real catalog-item line items separately from free-text ones, even with the same description", async () => {
  const { saleService, refundService, catalogService } = makeServices();
  const item = await catalogService.create("t1", "i1", "Haircut", "service", 150);
  const sale = await saleService.recordSale("t1", "s1", {
    lineItems: [
      { catalogItemId: item.id, quantity: 1, unitPrice: 150 },
      { description: "Haircut", quantity: 1, unitPrice: 150 }, // a different, free-text line with the same words
    ],
  });
  // Refunding 1 of the real catalog item must not be allowed to also count
  // against the separate free-text line's own quantity.
  await refundService.recordRefund("t1", "r1", sale.id, [{ catalogItemId: item.id, quantity: 1, unitPrice: 150 }]);
  await expect(
    refundService.recordRefund("t1", "r2", sale.id, [{ catalogItemId: item.id, quantity: 1, unitPrice: 150 }])
  ).rejects.toThrow(InvalidRefundError);
  // The free-text line's own 1 unit is still separately refundable.
  const stillOk = await refundService.recordRefund("t1", "r3", sale.id, [{ description: "Haircut", quantity: 1, unitPrice: 150 }]);
  expect(stillOk.refundAmount).toBe(150);
});

test("recordRefund throws SaleNotFoundError for a wrong tenant or unknown sale id", async () => {
  const { saleService, refundService } = makeServices();
  const sale = await saleService.recordSale("t1", "s1", { lineItems: [{ description: "Haircut", quantity: 1, unitPrice: 150 }] });
  await expect(refundService.recordRefund("t2", "r1", sale.id, [{ description: "Haircut", quantity: 1, unitPrice: 150 }])).rejects.toThrow(
    SaleNotFoundError
  );
  await expect(refundService.recordRefund("t1", "r1", "unknown", [{ description: "Haircut", quantity: 1, unitPrice: 150 }])).rejects.toThrow(
    SaleNotFoundError
  );
});

test("recordRefund rejects an empty line-item list and non-positive quantity/negative price", async () => {
  const { saleService, refundService } = makeServices();
  const sale = await saleService.recordSale("t1", "s1", { lineItems: [{ description: "Haircut", quantity: 1, unitPrice: 150 }] });
  await expect(refundService.recordRefund("t1", "r1", sale.id, [])).rejects.toThrow(InvalidRefundError);
  await expect(refundService.recordRefund("t1", "r2", sale.id, [{ description: "Haircut", quantity: 0, unitPrice: 150 }])).rejects.toThrow(
    InvalidRefundError
  );
  await expect(refundService.recordRefund("t1", "r3", sale.id, [{ description: "Haircut", quantity: 1, unitPrice: -1 }])).rejects.toThrow(
    InvalidRefundError
  );
});

test("listForSale returns every real refund recorded against a sale, tenant-scoped", async () => {
  const { saleService, refundService } = makeServices();
  const sale = await saleService.recordSale("t1", "s1", { lineItems: [{ description: "Haircut", quantity: 2, unitPrice: 150 }] });
  await refundService.recordRefund("t1", "r1", sale.id, [{ description: "Haircut", quantity: 1, unitPrice: 150 }]);
  const refunds = await refundService.listForSale("t1", sale.id);
  expect(refunds).toHaveLength(1);
  expect(await refundService.listForSale("t2", sale.id)).toEqual([]);
});

test("totalRefundedForPeriod sums real refunds within the period, excluding ones outside it", async () => {
  const { saleService, refundService } = makeServices();
  const sale = await saleService.recordSale("t1", "s1", { lineItems: [{ description: "Haircut", quantity: 3, unitPrice: 150 }] });
  await refundService.recordRefund("t1", "r1", sale.id, [{ description: "Haircut", quantity: 1, unitPrice: 150 }]);

  const now = new Date();
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  expect(await refundService.totalRefundedForPeriod("t1", yesterday, tomorrow)).toBe(150);

  const lastWeekStart = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
  const lastWeekEnd = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  expect(await refundService.totalRefundedForPeriod("t1", lastWeekStart, lastWeekEnd)).toBe(0);
});

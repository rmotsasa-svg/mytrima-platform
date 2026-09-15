import { randomUUID } from "node:crypto";
import { StaffPerformanceService } from "./staff-performance.service";
import { CommissionService } from "./commission.service";
import { InMemoryCommissionRateStore } from "./in-memory-commission-rate.store";
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

function makeServices() {
  const catalogService = new CatalogService(new InMemoryCatalogItemStore());
  const dealService = new DealService(new InMemoryDealStore(), catalogService);
  const ratingService = new RatingService(new InMemoryRatingStore());
  const npsService = new NpsService(new InMemoryNpsResponseStore());
  const saleService = new SaleService(new InMemorySaleStore(), dealService, ratingService, npsService, catalogService);
  const customerService = new CustomerService(new InMemoryCustomerStore(), ratingService, new ConsentService(new InMemoryConsentStore()));
  const commissionService = new CommissionService(new InMemoryCommissionRateStore());
  const staffPerformanceService = new StaffPerformanceService(saleService, customerService, commissionService);
  return { saleService, customerService, commissionService, staffPerformanceService };
}

const PERIOD_START = new Date(Date.now() - 60 * 60 * 1000);
const PERIOD_END = new Date(Date.now() + 60 * 60 * 1000);

test("computeForUser: real sales figures for exactly this staff member, no rate set yet", async () => {
  const { saleService, staffPerformanceService } = makeServices();
  await saleService.recordSale("t1", "s1", { recordedByUserId: "staff-1", lineItems: [{ description: "Haircut", quantity: 1, unitPrice: 100 }] });
  await saleService.recordSale("t1", "s2", { recordedByUserId: "staff-2", lineItems: [{ description: "Haircut", quantity: 1, unitPrice: 50 }] });

  const perf = await staffPerformanceService.computeForUser("t1", "staff-1", PERIOD_START, PERIOD_END);
  expect(perf.salesCount).toBe(1);
  expect(perf.salesAmount).toBe(100);
  expect(perf.commissionRatePercent).toBeNull();
  expect(perf.commissionEarned).toBe(0); // no rate configured — a real 0 owed, not a fabricated number
});

test("computeForUser: commissionEarned reflects a real configured rate against real sales", async () => {
  const { saleService, commissionService, staffPerformanceService } = makeServices();
  await commissionService.setRate("t1", randomUUID(), "staff-1", 10);
  await saleService.recordSale("t1", "s1", { recordedByUserId: "staff-1", lineItems: [{ description: "Haircut", quantity: 1, unitPrice: 200 }] });

  const perf = await staffPerformanceService.computeForUser("t1", "staff-1", PERIOD_START, PERIOD_END);
  expect(perf.commissionRatePercent).toBe(10);
  expect(perf.commissionEarned).toBe(20); // 10% of 200
});

test("computeForUser: customersCreated/customersUpdated count real customer attribution", async () => {
  const { customerService, staffPerformanceService } = makeServices();
  const c1 = await customerService.create("t1", "c1", "Palesa", undefined, undefined, undefined, undefined, "staff-1");
  await customerService.create("t1", "c2", "Thabo", undefined, undefined, undefined, undefined, "staff-2");
  // staff-2 later updates c1 — the update, not the create, attributes to staff-2's "updated" count.
  await customerService.update("t1", c1.id, "Palesa M.", undefined, undefined, undefined, undefined, "staff-2");

  const staff1 = await staffPerformanceService.computeForUser("t1", "staff-1", PERIOD_START, PERIOD_END);
  const staff2 = await staffPerformanceService.computeForUser("t1", "staff-2", PERIOD_START, PERIOD_END);
  expect(staff1.customersCreated).toBe(1); // c1
  expect(staff1.customersUpdated).toBe(0); // staff-2's update superseded staff-1 as "last editor" of c1
  expect(staff2.customersCreated).toBe(1); // c2
  // c1 (explicitly edited by staff-2) AND c2 (created by staff-2, and
  // CustomerService.create() sets updatedByUserId = createdByUserId — the
  // creator is also the initial "last touched by", until someone else
  // edits it — see that method's own comment).
  expect(staff2.customersUpdated).toBe(2);
});

test("computeForTenant composes performance for every given userId in one call", async () => {
  const { saleService, staffPerformanceService } = makeServices();
  await saleService.recordSale("t1", "s1", { recordedByUserId: "staff-1", lineItems: [{ description: "X", quantity: 1, unitPrice: 100 }] });
  await saleService.recordSale("t1", "s2", { recordedByUserId: "staff-2", lineItems: [{ description: "X", quantity: 1, unitPrice: 300 }] });

  const all = await staffPerformanceService.computeForTenant("t1", ["staff-1", "staff-2"], PERIOD_START, PERIOD_END);
  expect(all).toHaveLength(2);
  expect(all.find((p) => p.userId === "staff-1")?.salesAmount).toBe(100);
  expect(all.find((p) => p.userId === "staff-2")?.salesAmount).toBe(300);
});

import { randomUUID } from "node:crypto";
import { CommissionService, InvalidCommissionRateError, computeCommission } from "./commission.service";
import { InMemoryCommissionRateStore } from "./in-memory-commission-rate.store";

function makeService() {
  return new CommissionService(new InMemoryCommissionRateStore());
}

test("setRate persists a real rate", async () => {
  const service = makeService();
  const rate = await service.setRate("t1", randomUUID(), "staff-1", 5);
  expect(rate.ratePercent).toBe(5);
  expect(rate.userId).toBe("staff-1");
});

test("setRate rejects a rate outside 0-100", async () => {
  const service = makeService();
  await expect(service.setRate("t1", randomUUID(), "staff-1", -1)).rejects.toThrow(InvalidCommissionRateError);
  await expect(service.setRate("t1", randomUUID(), "staff-1", 101)).rejects.toThrow(InvalidCommissionRateError);
});

test("setRate replaces a staff member's existing rate rather than adding a second one", async () => {
  const service = makeService();
  await service.setRate("t1", randomUUID(), "staff-1", 5);
  await service.setRate("t1", randomUUID(), "staff-1", 10);
  const rate = await service.getRateForUser("t1", "staff-1");
  expect(rate?.ratePercent).toBe(10);
  const all = await service.listRatesForTenant("t1");
  expect(all).toHaveLength(1);
});

test("getRateForUser returns null when no rate has been set — not a fabricated 0", async () => {
  const service = makeService();
  expect(await service.getRateForUser("t1", "staff-1")).toBeNull();
});

test("listRatesForTenant is tenant-scoped", async () => {
  const service = makeService();
  await service.setRate("t1", randomUUID(), "staff-1", 5);
  await service.setRate("t2", randomUUID(), "staff-2", 9);
  const list = await service.listRatesForTenant("t1");
  expect(list).toHaveLength(1);
  expect(list[0].userId).toBe("staff-1");
});

/* ---------- computeCommission (pure) ---------- */

test("computeCommission: a real percentage of real sales", () => {
  expect(computeCommission(1000, 5)).toBe(50);
});

test("computeCommission: 0% rate earns 0, not null", () => {
  expect(computeCommission(1000, 0)).toBe(0);
});

test("computeCommission: rounds to 2 decimal places", () => {
  expect(computeCommission(333.33, 7)).toBe(23.33);
});

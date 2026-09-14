import { SalesTargetService, InvalidSalesTargetError, computeProgressPct } from "./sales-target.service";
import { InMemorySalesTargetStore } from "./in-memory-sales-target.store";

test("setTarget persists a tenant-level target when userId is omitted", async () => {
  const service = new SalesTargetService(new InMemorySalesTargetStore());
  const target = await service.setTarget("t1", "target1", new Date("2026-01-01"), new Date("2026-01-31"), 5000);
  expect(target.userId).toBeUndefined();
  expect(target.targetAmount).toBe(5000);
});

test("setTarget persists a per-staff target when userId is given", async () => {
  const service = new SalesTargetService(new InMemorySalesTargetStore());
  const target = await service.setTarget("t1", "target1", new Date("2026-01-01"), new Date("2026-01-31"), 2000, "staff-1");
  expect(target.userId).toBe("staff-1");
});

test("setTarget rejects periodEnd before periodStart", async () => {
  const service = new SalesTargetService(new InMemorySalesTargetStore());
  await expect(service.setTarget("t1", "target1", new Date("2026-01-31"), new Date("2026-01-01"), 5000)).rejects.toThrow(InvalidSalesTargetError);
});

test("setTarget rejects a negative targetAmount", async () => {
  const service = new SalesTargetService(new InMemorySalesTargetStore());
  await expect(service.setTarget("t1", "target1", new Date("2026-01-01"), new Date("2026-01-31"), -100)).rejects.toThrow(InvalidSalesTargetError);
});

test("listForTenant is tenant-scoped", async () => {
  const service = new SalesTargetService(new InMemorySalesTargetStore());
  await service.setTarget("t1", "target1", new Date("2026-01-01"), new Date("2026-01-31"), 5000);
  await service.setTarget("t2", "target2", new Date("2026-01-01"), new Date("2026-01-31"), 9999);
  const list = await service.listForTenant("t1");
  expect(list).toHaveLength(1);
  expect(list[0].targetAmount).toBe(5000);
});

/* ---------- computeProgressPct: "sales target on %" (2026-09-15) ---------- */

test("computeProgressPct: halfway to a target is 50%", () => {
  expect(computeProgressPct(2500, 5000)).toBe(50);
});

test("computeProgressPct: a target already beaten exceeds 100%, not clamped away", () => {
  expect(computeProgressPct(6000, 5000)).toBe(120);
});

test("computeProgressPct: zero actual sales against a real target is a real 0%, not null", () => {
  expect(computeProgressPct(0, 5000)).toBe(0);
});

test("computeProgressPct: a zero or negative target has no meaningful percentage — null, not a divide-by-zero", () => {
  expect(computeProgressPct(1000, 0)).toBeNull();
  expect(computeProgressPct(1000, -500)).toBeNull();
});

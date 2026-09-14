import { KpiBenchmarkService, InvalidKpiBenchmarkError, KpiBenchmark, resolveCheckPeriod } from "./kpi-benchmark.service";
import { InMemoryKpiBenchmarkStore } from "./in-memory-kpi-benchmark.store";
import { SalesKpis } from "./sale.service";

function baseKpis(overrides: Partial<SalesKpis>): SalesKpis {
  return {
    periodStart: new Date("2026-01-01"),
    periodEnd: new Date("2026-01-31"),
    transactionalVolume: 10,
    salesAmount: 1000,
    averageTransactionValue: 100,
    totalUnits: 15,
    unitsPerTransaction: 1.5,
    addonRate: 20,
    conversionRate: 30,
    churnRate: 10,
    averageRating: 4.5,
    averageNpsScore: 8,
    ...overrides,
  };
}

function baseBenchmark(overrides: Partial<KpiBenchmark>): KpiBenchmark {
  return {
    id: "b1",
    tenantId: "t1",
    kpi: "sales_amount",
    comparison: "below",
    thresholdValue: 500,
    cadence: "custom",
    periodStart: new Date("2026-01-01"),
    periodEnd: new Date("2026-01-31"),
    isActive: true,
    createdAt: new Date(),
    ...overrides,
  };
}

test("setBenchmark persists a real benchmark", async () => {
  const service = new KpiBenchmarkService(new InMemoryKpiBenchmarkStore());
  const benchmark = await service.setBenchmark("t1", "b1", "sales_amount", "below", 5000, new Date("2026-01-01"), new Date("2026-01-31"));
  expect(benchmark.thresholdValue).toBe(5000);
});

test("setBenchmark rejects periodEnd before periodStart", async () => {
  const service = new KpiBenchmarkService(new InMemoryKpiBenchmarkStore());
  await expect(service.setBenchmark("t1", "b1", "sales_amount", "below", 5000, new Date("2026-01-31"), new Date("2026-01-01"))).rejects.toThrow(InvalidKpiBenchmarkError);
});

test("checkBreach: 'below' comparison breaches when the actual value is under the threshold", () => {
  const service = new KpiBenchmarkService(new InMemoryKpiBenchmarkStore());
  const benchmark = baseBenchmark({ kpi: "sales_amount", comparison: "below", thresholdValue: 5000 });
  expect(service.checkBreach(benchmark, baseKpis({ salesAmount: 1000 }))).toBe(true);
  expect(service.checkBreach(benchmark, baseKpis({ salesAmount: 6000 }))).toBe(false);
});

test("checkBreach: 'above' comparison breaches when the actual value exceeds the threshold", () => {
  const service = new KpiBenchmarkService(new InMemoryKpiBenchmarkStore());
  const benchmark = baseBenchmark({ kpi: "transactional_volume", comparison: "above", thresholdValue: 5 });
  expect(service.checkBreach(benchmark, baseKpis({ transactionalVolume: 10 }))).toBe(true);
  expect(service.checkBreach(benchmark, baseKpis({ transactionalVolume: 2 }))).toBe(false);
});

test("checkBreach returns null (not a breach) when the KPI has no value yet — e.g. conversionRate with no engaged customers", () => {
  const service = new KpiBenchmarkService(new InMemoryKpiBenchmarkStore());
  const benchmark = baseBenchmark({ kpi: "conversion_rate", comparison: "below", thresholdValue: 20 });
  expect(service.checkBreach(benchmark, baseKpis({ conversionRate: null }))).toBeNull();
});

test("checkBreach works for churn_rate (added 2026-09-10, sourced from the Essential Growth Strategy KPIs doc) — 'above' breaches when churn is too high", () => {
  const service = new KpiBenchmarkService(new InMemoryKpiBenchmarkStore());
  const benchmark = baseBenchmark({ kpi: "churn_rate", comparison: "above", thresholdValue: 15 });
  expect(service.checkBreach(benchmark, baseKpis({ churnRate: 40 }))).toBe(true);
  expect(service.checkBreach(benchmark, baseKpis({ churnRate: 5 }))).toBe(false);
});

test("checkBreach returns null for churn_rate when there were no start-of-period customers to compute a rate over", () => {
  const service = new KpiBenchmarkService(new InMemoryKpiBenchmarkStore());
  const benchmark = baseBenchmark({ kpi: "churn_rate", comparison: "above", thresholdValue: 15 });
  expect(service.checkBreach(benchmark, baseKpis({ churnRate: null }))).toBeNull();
});

test("listActiveForTenant is tenant-scoped", async () => {
  const service = new KpiBenchmarkService(new InMemoryKpiBenchmarkStore());
  await service.setBenchmark("t1", "b1", "sales_amount", "below", 5000, new Date("2026-01-01"), new Date("2026-01-31"));
  await service.setBenchmark("t2", "b2", "sales_amount", "below", 9999, new Date("2026-01-01"), new Date("2026-01-31"));
  const list = await service.listActiveForTenant("t1");
  expect(list).toHaveLength(1);
  expect(list[0].thresholdValue).toBe(5000);
});

/* ---------- per-KPI real-world units (2026-09-15) ---------- */

test("setBenchmark rejects a conversion_rate/churn_rate threshold outside 0-100 — they're percentages", async () => {
  const service = new KpiBenchmarkService(new InMemoryKpiBenchmarkStore());
  await expect(service.setBenchmark("t1", "b1", "conversion_rate", "above", 150, new Date("2026-01-01"), new Date("2026-01-31"))).rejects.toThrow(InvalidKpiBenchmarkError);
  await expect(service.setBenchmark("t1", "b1", "churn_rate", "above", -5, new Date("2026-01-01"), new Date("2026-01-31"))).rejects.toThrow(InvalidKpiBenchmarkError);
  await expect(service.setBenchmark("t1", "b1", "conversion_rate", "above", 80, new Date("2026-01-01"), new Date("2026-01-31"))).resolves.toBeTruthy();
});

test("setBenchmark rejects an average_rating threshold outside 0-5 — a real star rating never exceeds 5", async () => {
  const service = new KpiBenchmarkService(new InMemoryKpiBenchmarkStore());
  await expect(service.setBenchmark("t1", "b1", "average_rating", "below", 6, new Date("2026-01-01"), new Date("2026-01-31"))).rejects.toThrow(InvalidKpiBenchmarkError);
  await expect(service.setBenchmark("t1", "b1", "average_rating", "below", 3.5, new Date("2026-01-01"), new Date("2026-01-31"))).resolves.toBeTruthy();
});

test("setBenchmark rejects an nps_score threshold outside 0-10 — this is the raw response scale, not the -100..100 index", async () => {
  const service = new KpiBenchmarkService(new InMemoryKpiBenchmarkStore());
  await expect(service.setBenchmark("t1", "b1", "nps_score", "below", 11, new Date("2026-01-01"), new Date("2026-01-31"))).rejects.toThrow(InvalidKpiBenchmarkError);
  await expect(service.setBenchmark("t1", "b1", "nps_score", "below", 7, new Date("2026-01-01"), new Date("2026-01-31"))).resolves.toBeTruthy();
});

test("checkBreach works against the new average_rating/nps_score KPIs, same as every other KPI", () => {
  const service = new KpiBenchmarkService(new InMemoryKpiBenchmarkStore());
  const ratingBenchmark = baseBenchmark({ kpi: "average_rating", comparison: "below", thresholdValue: 4 });
  expect(service.checkBreach(ratingBenchmark, baseKpis({ averageRating: 3 }))).toBe(true);
  expect(service.checkBreach(ratingBenchmark, baseKpis({ averageRating: 4.5 }))).toBe(false);
  expect(service.checkBreach(ratingBenchmark, baseKpis({ averageRating: null }))).toBeNull();

  const npsBenchmark = baseBenchmark({ kpi: "nps_score", comparison: "below", thresholdValue: 6 });
  expect(service.checkBreach(npsBenchmark, baseKpis({ averageNpsScore: 4 }))).toBe(true);
  expect(service.checkBreach(npsBenchmark, baseKpis({ averageNpsScore: 8 }))).toBe(false);
});

/* ---------- cadence: daily / continuous / custom (2026-09-15) ---------- */

test("setBenchmark rejects an unrecognized cadence", async () => {
  const service = new KpiBenchmarkService(new InMemoryKpiBenchmarkStore());
  // @ts-expect-error — intentionally passing an invalid cadence to prove the runtime check, not just the type check
  await expect(service.setBenchmark("t1", "b1", "sales_amount", "below", 5000, new Date("2026-01-01"), new Date("2026-01-31"), undefined, "weekly")).rejects.toThrow(InvalidKpiBenchmarkError);
});

test("setBenchmark defaults to cadence 'custom' when not given, unchanged existing behavior", async () => {
  const service = new KpiBenchmarkService(new InMemoryKpiBenchmarkStore());
  const benchmark = await service.setBenchmark("t1", "b1", "sales_amount", "below", 5000, new Date("2026-01-01"), new Date("2026-01-31"));
  expect(benchmark.cadence).toBe("custom");
});

test("resolveCheckPeriod: 'custom' cadence checks exactly the stored fixed period, unchanged", () => {
  const benchmark = baseBenchmark({ cadence: "custom", periodStart: new Date("2026-01-01"), periodEnd: new Date("2026-01-31") });
  const { periodStart, periodEnd } = resolveCheckPeriod(benchmark, new Date("2026-06-15T12:00:00Z"));
  expect(periodStart).toEqual(new Date("2026-01-01"));
  expect(periodEnd).toEqual(new Date("2026-01-31"));
});

test("resolveCheckPeriod: 'daily' cadence re-scopes to today (UTC) regardless of the stored period", () => {
  const benchmark = baseBenchmark({ cadence: "daily", periodStart: new Date("2026-01-01"), periodEnd: new Date("2026-01-31") });
  const { periodStart, periodEnd } = resolveCheckPeriod(benchmark, new Date("2026-06-15T14:32:00Z"));
  expect(periodStart).toEqual(new Date("2026-06-15T00:00:00.000Z"));
  expect(periodEnd).toEqual(new Date("2026-06-15T23:59:59.999Z"));
});

test("resolveCheckPeriod: 'continuous' cadence keeps its original start but its end keeps moving to now", () => {
  const benchmark = baseBenchmark({ cadence: "continuous", periodStart: new Date("2026-01-01"), periodEnd: new Date("2026-01-31") });
  const now = new Date("2026-06-15T14:32:00Z");
  const { periodStart, periodEnd } = resolveCheckPeriod(benchmark, now);
  expect(periodStart).toEqual(new Date("2026-01-01")); // unchanged original start
  expect(periodEnd).toEqual(now); // moved to "now", not the stored periodEnd
});

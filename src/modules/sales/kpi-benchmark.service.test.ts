import { KpiBenchmarkService, InvalidKpiBenchmarkError, KpiBenchmark } from "./kpi-benchmark.service";
import { InMemoryKpiBenchmarkStore } from "./in-memory-kpi-benchmark.store";
import { SalesKpis } from "./sale.service";

function baseKpis(overrides: Partial<SalesKpis>): SalesKpis {
  return {
    periodStart: new Date("2026-01-01"),
    periodEnd: new Date("2026-01-31"),
    transactionalVolume: 10,
    salesAmount: 1000,
    averageTransactionValue: 100,
    unitsPerTransaction: 1.5,
    addonRate: 20,
    conversionRate: 30,
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

test("listActiveForTenant is tenant-scoped", async () => {
  const service = new KpiBenchmarkService(new InMemoryKpiBenchmarkStore());
  await service.setBenchmark("t1", "b1", "sales_amount", "below", 5000, new Date("2026-01-01"), new Date("2026-01-31"));
  await service.setBenchmark("t2", "b2", "sales_amount", "below", 9999, new Date("2026-01-01"), new Date("2026-01-31"));
  const list = await service.listActiveForTenant("t1");
  expect(list).toHaveLength(1);
  expect(list[0].thresholdValue).toBe(5000);
});

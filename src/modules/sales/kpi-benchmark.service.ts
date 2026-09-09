import { Inject, Injectable } from "@nestjs/common";
import { KPI_BENCHMARK_STORE } from "./sales.tokens";
import { SalesKpis } from "./sale.service";

/**
 * Master Plan Addendum v1.3, Section E ("KPI benchmarks & automated
 * alerts"): a fourth Automation & Notification Engine trigger, alongside
 * the three that already exist (Growth Audit bands, NPS detractors,
 * moderated ratings). Scoped to Sales KPIs only — Growth Audit and NPS keep
 * their own proven, untouched logic. No industry-benchmark defaults exist;
 * every threshold here is tenant-set (see the addendum's own "Needs
 * verification" flag on industry figures).
 */

export type BenchmarkKpi = "sales_amount" | "conversion_rate" | "avg_transaction_value" | "units_per_transaction" | "transactional_volume" | "addon_rate";
export type BenchmarkComparison = "above" | "below";

export interface KpiBenchmark {
  id: string;
  tenantId: string;
  userId?: string;
  kpi: BenchmarkKpi;
  comparison: BenchmarkComparison;
  thresholdValue: number;
  periodStart: Date;
  periodEnd: Date;
  isActive: boolean;
  createdAt: Date;
}

export class InvalidKpiBenchmarkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidKpiBenchmarkError";
  }
}

export interface KpiBenchmarkStore {
  save(benchmark: KpiBenchmark): Promise<void>;
  findAllActiveForTenant(tenantId: string): Promise<KpiBenchmark[]>;
}

const KPI_TO_SALES_FIELD: Record<BenchmarkKpi, keyof SalesKpis | null> = {
  sales_amount: "salesAmount",
  conversion_rate: "conversionRate",
  avg_transaction_value: "averageTransactionValue",
  units_per_transaction: "unitsPerTransaction",
  transactional_volume: "transactionalVolume",
  addon_rate: "addonRate",
};

@Injectable()
export class KpiBenchmarkService {
  constructor(@Inject(KPI_BENCHMARK_STORE) private readonly store: KpiBenchmarkStore) {}

  async setBenchmark(
    tenantId: string,
    id: string,
    kpi: BenchmarkKpi,
    comparison: BenchmarkComparison,
    thresholdValue: number,
    periodStart: Date,
    periodEnd: Date,
    userId?: string
  ): Promise<KpiBenchmark> {
    if (periodEnd < periodStart) throw new InvalidKpiBenchmarkError("periodEnd must not be before periodStart");
    if (!Number.isFinite(thresholdValue)) throw new InvalidKpiBenchmarkError("thresholdValue must be a number");
    const benchmark: KpiBenchmark = { id, tenantId, userId, kpi, comparison, thresholdValue, periodStart, periodEnd, isActive: true, createdAt: new Date() };
    await this.store.save(benchmark);
    return benchmark;
  }

  async listActiveForTenant(tenantId: string): Promise<KpiBenchmark[]> {
    return this.store.findAllActiveForTenant(tenantId);
  }

  /**
   * Pure comparison — given a benchmark and the actual computed KPIs for its
   * period, does the value breach the threshold? Returns null when the KPI
   * being checked has no value yet (e.g. conversionRate with no engaged
   * customers in the period — see SaleService.computeKpis()), since "no
   * data" is not the same claim as "breached."
   */
  checkBreach(benchmark: KpiBenchmark, kpis: SalesKpis): boolean | null {
    const field = KPI_TO_SALES_FIELD[benchmark.kpi];
    if (!field) return null;
    const value = kpis[field] as number | null;
    if (value === null || value === undefined) return null;
    return benchmark.comparison === "above" ? value > benchmark.thresholdValue : value < benchmark.thresholdValue;
  }
}

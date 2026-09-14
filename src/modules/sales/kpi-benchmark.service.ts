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

export type BenchmarkKpi =
  | "sales_amount"
  | "conversion_rate"
  | "avg_transaction_value"
  | "units_per_transaction"
  | "transactional_volume"
  | "addon_rate"
  | "churn_rate"
  | "average_rating"
  | "nps_score";
export type BenchmarkComparison = "above" | "below";

/** Real-world units per KPI, sourced from the tenant's own explicit request
 * (2026-09-15): conversion_rate/churn_rate are percentages (0-100);
 * average_rating is a 1-5 star rating; nps_score is the raw 0-10 response
 * scale (deliberately NOT the standard -100..+100 NPS index computeNps()
 * reports elsewhere — the tenant asked for "NPS 10", the scale an
 * individual response actually uses); everything else is a plain unbounded
 * number (sales_amount is a currency amount, unitless here). Exported so
 * both validateThresholdForUnit() below and the frontend's BenchmarkForm
 * derive input bounds/labels from this one source of truth. */
export type BenchmarkKpiUnit = "percent" | "rating_5" | "nps_10" | "number";

export const KPI_UNIT: Record<BenchmarkKpi, BenchmarkKpiUnit> = {
  sales_amount: "number",
  conversion_rate: "percent",
  avg_transaction_value: "number",
  units_per_transaction: "number",
  transactional_volume: "number",
  addon_rate: "number",
  churn_rate: "percent",
  average_rating: "rating_5",
  nps_score: "nps_10",
};

const UNIT_BOUNDS: Partial<Record<BenchmarkKpiUnit, { min: number; max: number }>> = {
  percent: { min: 0, max: 100 },
  rating_5: { min: 0, max: 5 },
  nps_10: { min: 0, max: 10 },
};

function validateThresholdForUnit(kpi: BenchmarkKpi, thresholdValue: number): void {
  const unit = KPI_UNIT[kpi];
  const bounds = UNIT_BOUNDS[unit];
  if (bounds && (thresholdValue < bounds.min || thresholdValue > bounds.max)) {
    throw new InvalidKpiBenchmarkError(`${kpi} is a ${unit} value — thresholdValue must be between ${bounds.min} and ${bounds.max}, got ${thresholdValue}`);
  }
}

/** "targets must be set for daily and continues" — the tenant's own
 * explicit request (2026-09-15). 'custom' is the original, unchanged
 * behavior: a fixed period the tenant sets once. 'daily' re-scopes to
 * TODAY (UTC) every time it's checked, regardless of the stored period —
 * a target re-evaluated fresh each calendar day. 'continuous' keeps its
 * original start but its end keeps moving to "now" — an ever-growing,
 * ongoing window that never resets. See resolveCheckPeriod() below, the
 * one place that turns a benchmark's cadence into a concrete period to
 * check against. */
export type BenchmarkCadence = "custom" | "daily" | "continuous";
const VALID_CADENCES: readonly BenchmarkCadence[] = ["custom", "daily", "continuous"];

export interface KpiBenchmark {
  id: string;
  tenantId: string;
  userId?: string;
  kpi: BenchmarkKpi;
  comparison: BenchmarkComparison;
  thresholdValue: number;
  cadence: BenchmarkCadence;
  periodStart: Date;
  periodEnd: Date;
  isActive: boolean;
  createdAt: Date;
}

function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0));
}

function endOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59, 999));
}

/** Pure — the one place a benchmark's cadence becomes a concrete
 * {periodStart, periodEnd} to run computeKpis() against, as of `now`. See
 * BenchmarkCadence's own comment for what each cadence means. */
export function resolveCheckPeriod(benchmark: Pick<KpiBenchmark, "cadence" | "periodStart" | "periodEnd">, now: Date): { periodStart: Date; periodEnd: Date } {
  if (benchmark.cadence === "daily") return { periodStart: startOfUtcDay(now), periodEnd: endOfUtcDay(now) };
  if (benchmark.cadence === "continuous") return { periodStart: benchmark.periodStart, periodEnd: now };
  return { periodStart: benchmark.periodStart, periodEnd: benchmark.periodEnd };
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

// Exported (not module-private) so kpi-benchmark-check.service.ts can reuse
// this exact mapping instead of keeping its own separate copy — a real bug
// found 2026-09-10 while adding churn_rate: a second, hand-duplicated
// version of this same map lived in that file's notification-message
// construction, and had already silently drifted (missing churn_rate
// entirely) the moment this map gained a field the other copy didn't know
// about. One source of truth now.
export const KPI_TO_SALES_FIELD: Record<BenchmarkKpi, keyof SalesKpis | null> = {
  sales_amount: "salesAmount",
  conversion_rate: "conversionRate",
  avg_transaction_value: "averageTransactionValue",
  units_per_transaction: "unitsPerTransaction",
  transactional_volume: "transactionalVolume",
  addon_rate: "addonRate",
  churn_rate: "churnRate",
  average_rating: "averageRating",
  nps_score: "averageNpsScore",
};

@Injectable()
export class KpiBenchmarkService {
  constructor(@Inject(KPI_BENCHMARK_STORE) private readonly store: KpiBenchmarkStore) {}

  /** `cadence` is the last, optional parameter (default 'custom') so every
   * pre-existing call site — this codebase's own tests, the recommendation
   * engine's integration test — keeps working unchanged; only callers that
   * genuinely want daily/continuous re-scoping pass it. */
  async setBenchmark(
    tenantId: string,
    id: string,
    kpi: BenchmarkKpi,
    comparison: BenchmarkComparison,
    thresholdValue: number,
    periodStart: Date,
    periodEnd: Date,
    userId?: string,
    cadence: BenchmarkCadence = "custom"
  ): Promise<KpiBenchmark> {
    if (periodEnd < periodStart) throw new InvalidKpiBenchmarkError("periodEnd must not be before periodStart");
    if (!Number.isFinite(thresholdValue)) throw new InvalidKpiBenchmarkError("thresholdValue must be a number");
    if (!(VALID_CADENCES as readonly string[]).includes(cadence)) {
      throw new InvalidKpiBenchmarkError(`cadence must be one of ${VALID_CADENCES.join(", ")} — got "${cadence}"`);
    }
    validateThresholdForUnit(kpi, thresholdValue);
    const benchmark: KpiBenchmark = { id, tenantId, userId, kpi, comparison, thresholdValue, cadence, periodStart, periodEnd, isActive: true, createdAt: new Date() };
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

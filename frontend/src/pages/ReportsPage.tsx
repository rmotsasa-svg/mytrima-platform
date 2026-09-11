import { useEffect, useState } from "react";
import { SalesApi } from "../api/resources";
import type { BenchmarkComparison, BenchmarkKpi, CustomerLifetimeValueResult, KpiBenchmark, RepeatRateResult, SalesKpis, SalesTarget } from "../api/types";
import { useAuth } from "../auth/AuthContext";
import { ApiError } from "../api/client";
import { Banner, Button, Card, EmptyState, PageHeader, formatDateTime, formatMoney } from "../components/ui";

const BENCHMARK_KPI_LABELS: Record<BenchmarkKpi, string> = {
  sales_amount: "Sales amount",
  conversion_rate: "Conversion rate",
  avg_transaction_value: "Avg. transaction value",
  units_per_transaction: "Units per transaction",
  transactional_volume: "Transactions",
  addon_rate: "Add-on rate",
  churn_rate: "Churn rate",
};

function toDateInputValue(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** REAL BUG found live-verifying this page: a bare `YYYY-MM-DD` sent
 * straight to the backend's `new Date(periodEnd)` (sales.controller.ts)
 * parses as that date's UTC midnight — the very *start* of "today", not
 * its end. A sale recorded an hour ago on the day you're viewing then
 * falls AFTER `periodEnd` and silently drops out of every KPI, exactly
 * what happened testing this page against a same-day sale. `periodStart`
 * is fine as-is (a calendar date's own midnight is the correct start of
 * that day) — only the end of the range needs pushing to 23:59:59.999 on
 * that same calendar date before it ever leaves this page. Explicit `Z`
 * (not the local-time interpretation a timezone-less date-TIME string
 * would otherwise get) so this means the same instant regardless of which
 * machine's clock parses it — the same UTC convention a bare date-only
 * string like periodStart already gets for free. */
function endOfDayIso(dateInputValue: string): string {
  return `${dateInputValue}T23:59:59.999Z`;
}

/** Detail beyond the Business Snapshot's executive summary — the raw
 * per-KPI numbers, targets, and benchmarks Sales' own endpoints expose
 * (GET /sales/:tenantId/kpis, /repeat-rate, /lifetime-value, /targets,
 * /benchmarks) but the Snapshot page never surfaces individually. */
export function ReportsPage() {
  const { session } = useAuth();
  const tenantId = session.status === "loggedIn" ? session.profile.tenantId : "";
  const canManage = session.status === "loggedIn" && session.profile.role !== "read_only";

  const today = new Date();
  const monthAgo = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);
  const [periodStart, setPeriodStart] = useState(toDateInputValue(monthAgo));
  const [periodEnd, setPeriodEnd] = useState(toDateInputValue(today));

  const [kpis, setKpis] = useState<SalesKpis | null>(null);
  const [repeatRate, setRepeatRate] = useState<RepeatRateResult | null>(null);
  const [ltv, setLtv] = useState<CustomerLifetimeValueResult | null>(null);
  const [targets, setTargets] = useState<SalesTarget[]>([]);
  const [benchmarks, setBenchmarks] = useState<KpiBenchmark[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showTargetForm, setShowTargetForm] = useState(false);
  const [showBenchmarkForm, setShowBenchmarkForm] = useState(false);

  async function loadPeriodData() {
    if (!tenantId) return;
    setLoading(true);
    try {
      const [k, r, l] = await Promise.all([
        SalesApi.kpis(tenantId, periodStart, endOfDayIso(periodEnd)),
        SalesApi.repeatRate(tenantId, periodStart, endOfDayIso(periodEnd)),
        SalesApi.lifetimeValue(tenantId),
      ]);
      setKpis(k);
      setRepeatRate(r);
      setLtv(l);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load KPIs for this period.");
    } finally {
      setLoading(false);
    }
  }

  async function loadTargetsAndBenchmarks() {
    if (!tenantId) return;
    try {
      const [t, b] = await Promise.all([SalesApi.listTargets(tenantId), SalesApi.listBenchmarks(tenantId)]);
      setTargets(t);
      setBenchmarks(b);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load targets/benchmarks.");
    }
  }

  useEffect(() => {
    void loadTargetsAndBenchmarks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  useEffect(() => {
    void loadPeriodData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, periodStart, periodEnd]);

  return (
    <div>
      <PageHeader title="Reports" subtitle="The KPI detail behind the Business Snapshot — one number at a time, plus your own targets and benchmarks." />
      {error && <Banner kind="error">{error}</Banner>}

      <Card title="Period">
        <div className="form-grid" style={{ maxWidth: 480 }}>
          <div className="field">
            <label htmlFor="period-start">From</label>
            <input id="period-start" type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="period-end">To</label>
            <input id="period-end" type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} />
          </div>
        </div>
      </Card>

      <div style={{ height: "1.1rem" }} />

      {kpis && (
        <div className="stat-grid">
          <Stat label="Sales amount" value={formatMoney(kpis.salesAmount)} />
          <Stat label="Transactions" value={kpis.transactionalVolume.toLocaleString()} />
          <Stat label="Avg. transaction value" value={formatMoney(kpis.averageTransactionValue)} />
          <Stat label="Units sold" value={kpis.totalUnits.toLocaleString()} />
          <Stat label="Units per transaction" value={kpis.unitsPerTransaction.toFixed(2)} />
          <Stat label="Add-on rate" value={`${kpis.addonRate.toFixed(1)}%`} />
          <Stat label="Conversion rate" value={kpis.conversionRate === null ? "—" : `${kpis.conversionRate.toFixed(1)}%`} note={kpis.conversionRate === null ? "No engaged customers this period" : undefined} />
          <Stat label="Churn rate" value={kpis.churnRate === null ? "—" : `${kpis.churnRate.toFixed(1)}%`} note={kpis.churnRate === null ? "No named customers before this period" : undefined} />
        </div>
      )}

      <div style={{ height: "1.1rem" }} />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "1.1rem" }}>
        <Card title="Repeat rate (this period)">
          {repeatRate ? (
            <>
              <p style={{ marginTop: 0 }}>
                <strong className="tabular">{repeatRate.repeatRate === null ? "—" : `${repeatRate.repeatRate.toFixed(1)}%`}</strong>
                {repeatRate.repeatRate === null && <span style={{ color: "var(--color-ink-muted)", fontSize: "0.85rem" }}> — no new customers this period</span>}
              </p>
              <p style={{ fontSize: "0.85rem", color: "var(--color-ink-muted)", margin: 0 }}>
                {repeatRate.repeatCustomerCount} of {repeatRate.newCustomerCount} new customers this period have since bought again
              </p>
            </>
          ) : (
            <p style={{ color: "var(--color-ink-muted)" }}>—</p>
          )}
        </Card>
        <Card title="Customer lifetime value">
          {ltv ? (
            <>
              <p style={{ marginTop: 0 }}>
                <strong className="tabular">{formatMoney(ltv.lifetimeValue)}</strong>
              </p>
              <p style={{ fontSize: "0.85rem", color: "var(--color-ink-muted)", margin: 0 }}>
                {formatMoney(ltv.averageOrderValue)} avg. order × {ltv.purchaseFrequencyPerYear.toFixed(1)}/yr × {ltv.customerLifespanYears.toFixed(1)} yr lifespan
              </p>
            </>
          ) : (
            <p style={{ color: "var(--color-ink-muted)" }}>Not enough data yet — needs at least one customer with a second purchase.</p>
          )}
        </Card>
      </div>

      <div style={{ height: "1.3rem" }} />

      <Card
        title="Sales targets"
        actions={
          canManage && (
            <Button variant="primary" onClick={() => setShowTargetForm((s) => !s)}>
              {showTargetForm ? "Cancel" : "Set a target"}
            </Button>
          )
        }
      >
        {showTargetForm && (
          <>
            <TargetForm
              tenantId={tenantId}
              onSet={() => {
                setShowTargetForm(false);
                void loadTargetsAndBenchmarks();
              }}
            />
            <div style={{ height: "1rem" }} />
          </>
        )}
        {targets.length === 0 && !loading ? (
          <EmptyState>No sales targets set yet.</EmptyState>
        ) : (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Period</th>
                  <th>Target amount</th>
                  <th>Set</th>
                </tr>
              </thead>
              <tbody>
                {[...targets]
                  .sort((a, b) => new Date(b.periodStart).getTime() - new Date(a.periodStart).getTime())
                  .map((t) => (
                    <tr key={t.id}>
                      <td>
                        {new Date(t.periodStart).toLocaleDateString()} – {new Date(t.periodEnd).toLocaleDateString()}
                      </td>
                      <td className="tabular">{formatMoney(t.targetAmount)}</td>
                      <td>{formatDateTime(t.createdAt)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div style={{ height: "1.3rem" }} />

      <Card
        title="KPI benchmarks"
        actions={
          canManage && (
            <Button variant="primary" onClick={() => setShowBenchmarkForm((s) => !s)}>
              {showBenchmarkForm ? "Cancel" : "Set a benchmark"}
            </Button>
          )
        }
      >
        <p style={{ marginTop: 0, fontSize: "0.85rem", color: "var(--color-ink-muted)" }}>
          A benchmark just names a threshold — the automation worker checks live KPIs against these to decide when to notify, not this page.
        </p>
        {showBenchmarkForm && (
          <>
            <BenchmarkForm
              tenantId={tenantId}
              onSet={() => {
                setShowBenchmarkForm(false);
                void loadTargetsAndBenchmarks();
              }}
            />
            <div style={{ height: "1rem" }} />
          </>
        )}
        {benchmarks.length === 0 && !loading ? (
          <EmptyState>No active benchmarks.</EmptyState>
        ) : (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>KPI</th>
                  <th>Condition</th>
                  <th>Period</th>
                </tr>
              </thead>
              <tbody>
                {benchmarks.map((b) => (
                  <tr key={b.id}>
                    <td>{BENCHMARK_KPI_LABELS[b.kpi]}</td>
                    <td>
                      {b.comparison} {b.thresholdValue}
                    </td>
                    <td>
                      {new Date(b.periodStart).toLocaleDateString()} – {new Date(b.periodEnd).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="card stat-tile">
      <p className="card-title">{label}</p>
      <p className="stat-value">{value}</p>
      {note && (
        <p className="stat-delta" data-dir="flat">
          {note}
        </p>
      )}
    </div>
  );
}

function TargetForm({ tenantId, onSet }: { tenantId: string; onSet: () => void }) {
  const today = new Date();
  const monthAhead = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000);
  const [periodStart, setPeriodStart] = useState(toDateInputValue(today));
  const [periodEnd, setPeriodEnd] = useState(toDateInputValue(monthAhead));
  const [targetAmount, setTargetAmount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    setError(null);
    setSubmitting(true);
    try {
      await SalesApi.setTarget(tenantId, periodStart, endOfDayIso(periodEnd), targetAmount);
      onSet();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not set this target.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="card" style={{ background: "var(--color-surface-sunken)" }}>
      {error && <Banner kind="error">{error}</Banner>}
      <div className="form-grid">
        <div className="field">
          <label htmlFor="target-start">From</label>
          <input id="target-start" type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="target-end">To</label>
          <input id="target-end" type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="target-amount">Target amount</label>
          <input id="target-amount" type="number" min={0} step="0.01" value={targetAmount} onChange={(e) => setTargetAmount(Number(e.target.value))} />
        </div>
        <Button variant="primary" disabled={submitting} onClick={() => void handleSubmit()}>
          {submitting ? "Setting…" : "Set target"}
        </Button>
      </div>
    </div>
  );
}

const BENCHMARK_KPIS: BenchmarkKpi[] = [
  "sales_amount",
  "conversion_rate",
  "avg_transaction_value",
  "units_per_transaction",
  "transactional_volume",
  "addon_rate",
  "churn_rate",
];

function BenchmarkForm({ tenantId, onSet }: { tenantId: string; onSet: () => void }) {
  const today = new Date();
  const monthAhead = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000);
  const [kpi, setKpi] = useState<BenchmarkKpi>("sales_amount");
  const [comparison, setComparison] = useState<BenchmarkComparison>("above");
  const [thresholdValue, setThresholdValue] = useState(0);
  const [periodStart, setPeriodStart] = useState(toDateInputValue(today));
  const [periodEnd, setPeriodEnd] = useState(toDateInputValue(monthAhead));
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    setError(null);
    setSubmitting(true);
    try {
      await SalesApi.setBenchmark(tenantId, kpi, comparison, thresholdValue, periodStart, endOfDayIso(periodEnd));
      onSet();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not set this benchmark.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="card" style={{ background: "var(--color-surface-sunken)" }}>
      {error && <Banner kind="error">{error}</Banner>}
      <div className="form-grid">
        <div className="field">
          <label htmlFor="bm-kpi">KPI</label>
          <select id="bm-kpi" value={kpi} onChange={(e) => setKpi(e.target.value as BenchmarkKpi)}>
            {BENCHMARK_KPIS.map((k) => (
              <option key={k} value={k}>
                {BENCHMARK_KPI_LABELS[k]}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="bm-comparison">Alert when</label>
          <select id="bm-comparison" value={comparison} onChange={(e) => setComparison(e.target.value as BenchmarkComparison)}>
            <option value="above">Above threshold</option>
            <option value="below">Below threshold</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="bm-threshold">Threshold</label>
          <input id="bm-threshold" type="number" step="0.01" value={thresholdValue} onChange={(e) => setThresholdValue(Number(e.target.value))} />
        </div>
        <div className="field">
          <label htmlFor="bm-start">From</label>
          <input id="bm-start" type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="bm-end">To</label>
          <input id="bm-end" type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} />
        </div>
        <Button variant="primary" disabled={submitting} onClick={() => void handleSubmit()}>
          {submitting ? "Setting…" : "Set benchmark"}
        </Button>
      </div>
    </div>
  );
}

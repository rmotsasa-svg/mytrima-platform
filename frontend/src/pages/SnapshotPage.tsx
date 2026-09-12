import { useEffect, useState } from "react";
import { SnapshotApi } from "../api/resources";
import type { BusinessSnapshot, ProductContribution, SalesTrendPoint } from "../api/types";
import { useAuth } from "../auth/AuthContext";
import { ApiError } from "../api/client";
import { Banner, Card, EmptyState, PageHeader, Pill, formatMoney, formatPct } from "../components/ui";

function directionOf(current: number, previous: number): "up" | "down" | "flat" {
  if (current > previous) return "up";
  if (current < previous) return "down";
  return "flat";
}

export function SnapshotPage() {
  const { session } = useAuth();
  const tenantId = session.status === "loggedIn" ? session.profile.tenantId : "";
  const [snapshot, setSnapshot] = useState<BusinessSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!tenantId) return;
    setLoading(true);
    SnapshotApi.get(tenantId)
      .then(setSnapshot)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load the business snapshot."))
      .finally(() => setLoading(false));
  }, [tenantId]);

  if (loading) return <p>Loading snapshot…</p>;
  if (error) return <Banner kind="error">{error}</Banner>;
  if (!snapshot) return null;

  const { performance, experienceMetrics, growthAudit } = snapshot;

  return (
    <div>
      <PageHeader
        title="Business snapshot"
        subtitle={`${new Date(snapshot.period.start).toLocaleDateString()} – ${new Date(snapshot.period.end).toLocaleDateString()}, vs. the period before`}
      />

      {snapshot.executiveSummary.length > 0 && (
        <Card title="Executive summary">
          <ul style={{ margin: 0, paddingLeft: "1.1rem" }}>
            {snapshot.executiveSummary.map((line, i) => (
              <li key={i} style={{ marginBottom: "0.3rem" }}>
                {line}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div style={{ height: "1.1rem" }} />

      <div className="stat-grid">
        <StatTile label="Sales amount" current={performance.salesAmount.current} previous={performance.salesAmount.previous} money />
        <StatTile label="Transactions" current={performance.transactionalVolume.current} previous={performance.transactionalVolume.previous} />
        <StatTile label="Avg. transaction value" current={performance.averageTransactionValue.current} previous={performance.averageTransactionValue.previous} money />
        <StatTile label="Units sold" current={performance.totalUnits.current} previous={performance.totalUnits.previous} />
        <RateTile label="Repeat rate" current={performance.repeatRate.current} previous={performance.repeatRate.previous} />
        <RateTile label="Conversion rate" current={performance.conversionRate.current} previous={performance.conversionRate.previous} />
        <RateTile label="Churn rate" current={performance.churnRate.current} previous={performance.churnRate.previous} invert />
        <RateTile label="NPS" current={experienceMetrics.nps.current} previous={experienceMetrics.nps.previous} suffix="" note={`${experienceMetrics.nps.currentCount} responses`} />
        <RateTile label="Rating" current={experienceMetrics.rating.current} previous={experienceMetrics.rating.previous} suffix="/5" note={`${experienceMetrics.rating.currentCount} ratings`} />
      </div>

      <div style={{ height: "1.1rem" }} />

      <TodayMonitoring monitoring={snapshot.dailyMonitoring} />

      <div style={{ height: "1.1rem" }} />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: "1.1rem" }}>
        <Card title="Sales trend">
          {snapshot.salesTrend.length > 0 ? (
            <SalesTrendChart points={snapshot.salesTrend} />
          ) : (
            <p style={{ color: "var(--color-ink-muted)" }}>No sales recorded in this period.</p>
          )}
        </Card>
        <Card title="Product contribution">
          {snapshot.productContribution.length > 0 ? (
            <ProductContributionBars items={snapshot.productContribution} />
          ) : (
            <EmptyState>No product/service revenue recorded this period.</EmptyState>
          )}
        </Card>
      </div>

      <div style={{ height: "1.1rem" }} />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: "1.1rem" }}>
        <Card title="Growth audit">
          {growthAudit.latestScore === null ? (
            <p style={{ color: "var(--color-ink-muted)" }}>No growth audit submitted yet.</p>
          ) : (
            <p>
              Latest score: <strong className="tabular">{growthAudit.latestScore}</strong>{" "}
              {growthAudit.latestBand && <Pill tone="gold">{growthAudit.latestBand}</Pill>}
            </p>
          )}
        </Card>
        <Card title="Findings">
          {snapshot.findings.length === 0 ? (
            <p style={{ color: "var(--color-ink-muted)" }}>Nothing notable this period.</p>
          ) : (
            <ul style={{ margin: 0, paddingLeft: "1.1rem" }}>
              {snapshot.findings.map((f, i) => (
                <li key={i} style={{ marginBottom: "0.5rem" }}>
                  <Pill tone={f.severity === "positive" ? "positive" : f.severity === "attention" ? "attention" : "neutral"}>{f.headline}</Pill>
                  <div style={{ fontSize: "0.85rem", color: "var(--color-ink-muted)", marginTop: "0.2rem" }}>{f.detail}</div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {snapshot.actionPlan.length > 0 && (
        <>
          <div style={{ height: "1.1rem" }} />
          <Card title="Recommended next steps">
            <ol style={{ margin: 0, paddingLeft: "1.1rem" }}>
              {snapshot.actionPlan.map((item, i) => (
                <li key={i} style={{ marginBottom: "0.5rem" }}>
                  <strong>{item.label}</strong>
                  <div style={{ fontSize: "0.85rem", color: "var(--color-ink-muted)" }}>{item.why}</div>
                </li>
              ))}
            </ol>
          </Card>
        </>
      )}
    </div>
  );
}

function StatTile({ label, current, previous, money }: { label: string; current: number; previous: number; money?: boolean }) {
  const dir = directionOf(current, previous);
  const pct = previous !== 0 ? ((current - previous) / Math.abs(previous)) * 100 : null;
  return (
    <div className="card stat-tile">
      <p className="card-title">{label}</p>
      <p className="stat-value">{money ? formatMoney(current) : current.toLocaleString()}</p>
      <p className="stat-delta" data-dir={dir}>
        {formatPct(pct)} vs. prior period
      </p>
    </div>
  );
}

function RateTile({
  label,
  current,
  previous,
  suffix = "%",
  invert,
  note,
}: {
  label: string;
  current: number | null;
  previous: number | null;
  suffix?: string;
  invert?: boolean;
  note?: string;
}) {
  const dir = current === null || previous === null ? "flat" : invert ? directionOf(previous, current) : directionOf(current, previous);
  return (
    <div className="card stat-tile">
      <p className="card-title">{label}</p>
      <p className="stat-value">{current === null ? "—" : `${current.toFixed(1)}${suffix}`}</p>
      <p className="stat-delta" data-dir={dir}>
        {previous === null || current === null ? note ?? "No prior data" : `${current > previous ? "▲" : current < previous ? "▼" : "–"} from ${previous.toFixed(1)}${suffix}`}
        {note && previous !== null && current !== null ? ` · ${note}` : ""}
      </p>
    </div>
  );
}

/** Real-time "how's today going" — added 2026-09-12 at the tenant's own
 * explicit request for daily sales monitoring on an hourly basis, distinct
 * from the period-level stat tiles above. Budget is honestly `null` (see
 * snapshot.service.ts's own computeDailyBudget() comment) when no Sales
 * Target covers today — rendered as "No budget set for today", never a
 * fabricated number. */
function TodayMonitoring({ monitoring }: { monitoring: BusinessSnapshot["dailyMonitoring"] }) {
  const { budget, actual, lastYearActual, hourlyTrend } = monitoring;
  const pctOfBudget = budget !== null && budget > 0 ? Math.round((actual / budget) * 1000) / 10 : null;
  const vsLastYear = lastYearActual !== 0 ? Math.round(((actual - lastYearActual) / lastYearActual) * 1000) / 10 : null;

  return (
    <Card title={`Today — ${new Date(`${monitoring.date}T00:00:00Z`).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })}`}>
      <div className="stat-grid" style={{ marginBottom: "0.9rem" }}>
        <div className="card stat-tile">
          <p className="card-title">Budget (today)</p>
          <p className="stat-value">{budget === null ? "—" : formatMoney(budget)}</p>
          <p className="stat-delta" data-dir="flat">
            {budget === null ? "No target set for today" : "Prorated from your Sales Target"}
          </p>
        </div>
        <div className="card stat-tile">
          <p className="card-title">Actual (today)</p>
          <p className="stat-value">{formatMoney(actual)}</p>
          <p className="stat-delta" data-dir={pctOfBudget === null ? "flat" : pctOfBudget >= 100 ? "up" : "down"}>
            {pctOfBudget === null ? "No budget to compare against" : `${pctOfBudget}% of today's budget`}
          </p>
        </div>
        <div className="card stat-tile">
          <p className="card-title">Same day last year</p>
          <p className="stat-value">{formatMoney(lastYearActual)}</p>
          <p className="stat-delta" data-dir={vsLastYear === null ? "flat" : vsLastYear >= 0 ? "up" : "down"}>
            {vsLastYear === null ? "No sales that day last year" : `${formatPct(vsLastYear)} vs. this day last year`}
          </p>
        </div>
      </div>
      <HourlyBarChart points={hourlyTrend} budget={budget} />
    </Card>
  );
}

/** Rounds up to a "nice" axis ceiling (1/2/5 x 10^n) so gridline labels
 * are real round figures. */
function niceCeiling(value: number): number {
  if (value <= 0) return 1;
  const exponent = Math.floor(Math.log10(value));
  const fraction = value / 10 ** exponent;
  const niceFraction = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10;
  return niceFraction * 10 ** exponent;
}

function formatAxisMoney(amount: number): string {
  return `LSL ${new Intl.NumberFormat("en-ZA", { notation: "compact", maximumFractionDigits: 1 }).format(amount)}`;
}

function formatShortDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
}

function formatHour(hour: number): string {
  return new Date(Date.UTC(2000, 0, 1, hour)).toLocaleTimeString(undefined, { hour: "numeric", timeZone: "UTC" });
}

/** Hand-rolled SVG line/area chart — no charting library, matching this
 * project's own "hand-roll simple things" discipline. `points` always
 * comes zero-filled from the backend. */
function SalesTrendChart({ points }: { points: SalesTrendPoint[] }) {
  const width = 640;
  const height = 200;
  const paddingLeft = 64;
  const paddingRight = 12;
  const paddingTop = 16;
  const paddingBottom = 26;
  const plotWidth = width - paddingLeft - paddingRight;
  const plotHeight = height - paddingTop - paddingBottom;

  const maxAmount = Math.max(...points.map((p) => p.salesAmount), 0);
  const axisMax = niceCeiling(maxAmount || 1);

  const xAt = (i: number) => paddingLeft + (points.length === 1 ? plotWidth / 2 : (i / (points.length - 1)) * plotWidth);
  const yAt = (amount: number) => paddingTop + plotHeight - (amount / axisMax) * plotHeight;
  const floorY = paddingTop + plotHeight;

  const linePath = points.map((p, i) => `${i === 0 ? "M" : "L"} ${xAt(i).toFixed(1)} ${yAt(p.salesAmount).toFixed(1)}`).join(" ");
  const areaPath = `${linePath} L ${xAt(points.length - 1).toFixed(1)} ${floorY.toFixed(1)} L ${xAt(0).toFixed(1)} ${floorY.toFixed(1)} Z`;

  const gridFractions = [0, 0.25, 0.5, 0.75, 1];
  const labelEvery = Math.max(1, Math.ceil(points.length / 7));
  const last = points[points.length - 1];

  return (
    <svg viewBox={`0 0 ${width} ${height}`} style={{ width: "100%", height: "auto", display: "block" }} role="img" aria-label="Daily sales amount over the selected period">
      {gridFractions.map((fraction) => (
        <g key={fraction}>
          <line x1={paddingLeft} x2={width - paddingRight} y1={yAt(fraction * axisMax)} y2={yAt(fraction * axisMax)} stroke="var(--color-border)" strokeWidth={1} />
          <text x={paddingLeft - 8} y={yAt(fraction * axisMax)} textAnchor="end" dominantBaseline="middle" fontSize="10" fill="var(--color-ink-muted)">
            {formatAxisMoney(fraction * axisMax)}
          </text>
        </g>
      ))}
      <path d={areaPath} fill="var(--color-mint-soft)" stroke="none" />
      <path d={linePath} fill="none" stroke="var(--color-teal)" strokeWidth={2} />
      {points.map((p, i) =>
        i % labelEvery === 0 || i === points.length - 1 ? (
          <text key={p.date} x={xAt(i)} y={height - 8} textAnchor="middle" fontSize="9" fill="var(--color-ink-muted)">
            {formatShortDate(p.date)}
          </text>
        ) : null
      )}
      {last && <circle cx={xAt(points.length - 1)} cy={yAt(last.salesAmount)} r={3.5} fill="var(--color-teal)" />}
    </svg>
  );
}

/** 24 real hourly bars for today, with an optional dashed line at the
 * per-hour share of today's own budget (budget / 24) so a glance shows
 * whether a given hour is pulling its weight, not just a raw total. */
function HourlyBarChart({ points, budget }: { points: { hour: number; salesAmount: number; transactionCount: number }[]; budget: number | null }) {
  const width = 640;
  const height = 160;
  const paddingLeft = 56;
  const paddingRight = 12;
  const paddingTop = 12;
  const paddingBottom = 22;
  const plotWidth = width - paddingLeft - paddingRight;
  const plotHeight = height - paddingTop - paddingBottom;

  const perHourBudget = budget !== null ? budget / 24 : null;
  const maxAmount = Math.max(...points.map((p) => p.salesAmount), perHourBudget ?? 0, 0);
  const axisMax = niceCeiling(maxAmount || 1);

  const barWidth = plotWidth / points.length;
  const yAt = (amount: number) => paddingTop + plotHeight - (amount / axisMax) * plotHeight;
  const floorY = paddingTop + plotHeight;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} style={{ width: "100%", height: "auto", display: "block" }} role="img" aria-label="Today's sales by hour">
      <line x1={paddingLeft} x2={width - paddingRight} y1={floorY} y2={floorY} stroke="var(--color-border)" strokeWidth={1} />
      {perHourBudget !== null && (
        <line
          x1={paddingLeft}
          x2={width - paddingRight}
          y1={yAt(perHourBudget)}
          y2={yAt(perHourBudget)}
          stroke="var(--color-attention)"
          strokeWidth={1}
          strokeDasharray="4 3"
        />
      )}
      {points.map((p, i) => {
        const barHeight = Math.max(0, floorY - yAt(p.salesAmount));
        return (
          <rect
            key={p.hour}
            x={(paddingLeft + i * barWidth + 1).toFixed(1)}
            y={yAt(p.salesAmount).toFixed(1)}
            width={Math.max(1, barWidth - 2).toFixed(1)}
            height={barHeight.toFixed(1)}
            fill="var(--color-teal)"
          />
        );
      })}
      {[0, 6, 12, 18, 23].map((hour) => (
        <text key={hour} x={paddingLeft + hour * barWidth + barWidth / 2} y={height - 6} textAnchor="middle" fontSize="9" fill="var(--color-ink-muted)">
          {formatHour(hour)}
        </text>
      ))}
      <text x={paddingLeft - 6} y={yAt(axisMax)} textAnchor="end" dominantBaseline="middle" fontSize="9" fill="var(--color-ink-muted)">
        {formatAxisMoney(axisMax)}
      </text>
    </svg>
  );
}

/** Bars sized relative to the period's own top product. */
function ProductContributionBars({ items }: { items: ProductContribution[] }) {
  const maxShare = Math.max(...items.map((i) => i.share), 1);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.7rem" }}>
      {items.map((item) => (
        <div key={item.catalogItemId ?? "__other__"}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: "0.75rem", fontSize: "0.85rem", marginBottom: "0.3rem" }}>
            <span>{item.name}</span>
            <span className="tabular" style={{ color: "var(--color-ink-muted)", whiteSpace: "nowrap" }}>
              {formatMoney(item.revenue)} · {item.unitsSold} sold · {item.share.toFixed(1)}%
            </span>
          </div>
          <div style={{ background: "var(--color-surface-sunken)", borderRadius: 5, height: 8, overflow: "hidden" }}>
            <div style={{ width: `${(item.share / maxShare) * 100}%`, height: "100%", background: "var(--color-teal)", borderRadius: 5 }} />
          </div>
        </div>
      ))}
    </div>
  );
}

import { useEffect, useState } from "react";
import { SnapshotApi } from "../api/resources";
import type { BusinessSnapshot } from "../api/types";
import { useAuth } from "../auth/AuthContext";
import { ApiError } from "../api/client";
import { Banner, Card, PageHeader, Pill, formatMoney, formatPct } from "../components/ui";

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
                  <strong>{item.title}</strong>
                  <div style={{ fontSize: "0.85rem", color: "var(--color-ink-muted)" }}>{item.rationale}</div>
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

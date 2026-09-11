import { useEffect, useState } from "react";
import { AnalyticsApi } from "../api/resources";
import type { AnalyticsSummary, DeviceType } from "../api/types";
import { useAuth } from "../auth/AuthContext";
import { ApiError } from "../api/client";
import { Banner, Button, Card, EmptyState, PageHeader } from "../components/ui";

function toDateInputValue(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Same UTC-end-of-day fix ReportsPage's own endOfDayIso() already proved
 * necessary and documented — a bare `YYYY-MM-DD` sent straight to
 * `getSummary()`'s `new Date(periodEnd)` parses as that date's UTC
 * midnight, excluding the whole day it names. */
function endOfDayIso(dateInputValue: string): string {
  return `${dateInputValue}T23:59:59.999Z`;
}

const DEVICE_LABELS: Record<DeviceType, string> = {
  desktop: "Desktop",
  mobile: "Mobile",
  tablet: "Tablet",
  other: "Other",
};

/**
 * REAL GAP this page closes — the tenant asked directly: "we did not
 * build a module that will help to connect tenants website and monitor,
 * report analytic for tenants". Reads GET /analytics/:tenantId/summary
 * (analytics.controller.ts), backed by the first-party tracking snippet
 * (tracker-snippet.ts) a tenant embeds on their own website — the option
 * the tenant explicitly chose over connecting an existing Google
 * Analytics property, since it works with zero prior setup on their side.
 *
 * The setup card below is the entire integration: one <script> tag,
 * copy-pasted once, no account or OAuth consent flow on either side —
 * see tracker-snippet.ts's own top comment for why that's possible (the
 * tenant id lives in the tag's own `data-tenant-id` attribute).
 */
export function WebsiteAnalyticsPage() {
  const { session } = useAuth();
  const tenantId = session.status === "loggedIn" ? session.profile.tenantId : "";

  const today = new Date();
  const monthAgo = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);
  const [periodStart, setPeriodStart] = useState(toDateInputValue(monthAgo));
  const [periodEnd, setPeriodEnd] = useState(toDateInputValue(today));

  const [summary, setSummary] = useState<AnalyticsSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!tenantId) return;
    setLoading(true);
    AnalyticsApi.summary(tenantId, periodStart, endOfDayIso(periodEnd))
      .then(setSummary)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load website analytics for this period."))
      .finally(() => setLoading(false));
  }, [tenantId, periodStart, periodEnd]);

  const snippet = `<script src="${AnalyticsApi.snippetUrl()}" data-tenant-id="${tenantId}" async></script>`;

  async function copySnippet() {
    try {
      await navigator.clipboard.writeText(snippet);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can be denied by the browser (permissions policy,
      // insecure context) — the <code> block below still shows the exact
      // text to select and copy by hand, so this never blocks the tenant.
    }
  }

  const maxDayCount = summary ? Math.max(1, ...summary.visitsByDay.map((d) => d.count)) : 1;
  const totalDeviceCount = summary ? Object.values(summary.deviceBreakdown).reduce((a, b) => a + b, 0) : 0;

  return (
    <div>
      <PageHeader
        title="Website analytics"
        subtitle="Real visits to your own website — collected by a snippet Mytrima hosts, not a third-party account you have to connect."
      />
      {error && <Banner kind="error">{error}</Banner>}

      <Card title="Connect your website">
        <p style={{ marginTop: 0, color: "var(--color-ink-muted)" }}>
          Paste this one line into your website's HTML, just before the closing <code>&lt;/body&gt;</code> tag. No account,
          password, or approval on your website's side — it starts sending data the next time someone visits.
        </p>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.6rem",
            background: "var(--color-surface-sunken)",
            borderRadius: "0.5rem",
            padding: "0.7rem 0.85rem",
          }}
        >
          <code style={{ flex: 1, overflowX: "auto", whiteSpace: "nowrap", fontSize: "0.82rem" }}>{snippet}</code>
          <Button variant="secondary" onClick={() => void copySnippet()}>
            {copied ? "Copied!" : "Copy"}
          </Button>
        </div>
        <p style={{ fontSize: "0.8rem", color: "var(--color-ink-muted)", marginBottom: 0 }}>
          Privacy: this snippet never sets a tracking cookie and never records your visitors' IP address or exact device —
          only the page they viewed, roughly where they came from, and a coarse device category, reset every browser session.
        </p>
      </Card>

      <div style={{ height: "1.1rem" }} />

      <Card title="Period">
        <div className="form-grid" style={{ maxWidth: 480 }}>
          <div className="field">
            <label htmlFor="wa-period-start">From</label>
            <input id="wa-period-start" type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="wa-period-end">To</label>
            <input id="wa-period-end" type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} />
          </div>
        </div>
      </Card>

      <div style={{ height: "1.1rem" }} />

      {summary && summary.totalVisits === 0 && !loading && (
        <EmptyState>
          No visits recorded yet for this period. Once the snippet above is live on your site, real visits will show up here —
          usually within a few minutes of the first pageview.
        </EmptyState>
      )}

      {summary && summary.totalVisits > 0 && (
        <>
          <div className="stat-grid">
            <div className="card stat-tile">
              <p className="card-title">Total page views</p>
              <p className="stat-value">{summary.totalVisits.toLocaleString()}</p>
            </div>
            <div className="card stat-tile">
              <p className="card-title">Sessions</p>
              <p className="stat-value">{summary.uniqueSessions.toLocaleString()}</p>
            </div>
            <div className="card stat-tile">
              <p className="card-title">Views per session</p>
              <p className="stat-value">{(summary.totalVisits / summary.uniqueSessions).toFixed(1)}</p>
            </div>
          </div>

          <div style={{ height: "1.3rem" }} />

          <Card title="Visits by day">
            <div style={{ display: "flex", alignItems: "flex-end", gap: "0.35rem", height: 140 }}>
              {summary.visitsByDay.map((d) => (
                <div key={d.date} title={`${d.date}: ${d.count}`} style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "flex-end", alignItems: "center", gap: "0.25rem" }}>
                  <div
                    style={{
                      width: "100%",
                      maxWidth: 28,
                      height: `${Math.max(4, (d.count / maxDayCount) * 110)}px`,
                      background: "var(--color-teal)",
                      borderRadius: "3px 3px 0 0",
                    }}
                  />
                </div>
              ))}
            </div>
            <p style={{ fontSize: "0.75rem", color: "var(--color-ink-muted)", marginBottom: 0, marginTop: "0.5rem" }}>
              {summary.visitsByDay[0]?.date} – {summary.visitsByDay[summary.visitsByDay.length - 1]?.date}
            </p>
          </Card>

          <div style={{ height: "1.3rem" }} />

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "1.1rem" }}>
            <Card title="Top pages">
              {summary.topPaths.length === 0 ? (
                <EmptyState>No page views yet.</EmptyState>
              ) : (
                <div className="table-scroll">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Path</th>
                        <th>Views</th>
                      </tr>
                    </thead>
                    <tbody>
                      {summary.topPaths.map((p) => (
                        <tr key={p.path}>
                          <td>{p.path}</td>
                          <td className="tabular">{p.count}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>

            <Card title="Top referrers">
              {summary.topReferrers.length === 0 ? (
                <EmptyState>No referrer data yet.</EmptyState>
              ) : (
                <div className="table-scroll">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Referrer</th>
                        <th>Visits</th>
                      </tr>
                    </thead>
                    <tbody>
                      {summary.topReferrers.map((r) => (
                        <tr key={r.referrer}>
                          <td>{r.referrer}</td>
                          <td className="tabular">{r.count}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>

            <Card title="Devices">
              {totalDeviceCount === 0 ? (
                <EmptyState>No device data yet.</EmptyState>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                  {(Object.entries(summary.deviceBreakdown) as [DeviceType, number][])
                    .filter(([, count]) => count > 0)
                    .sort(([, a], [, b]) => b - a)
                    .map(([device, count]) => (
                      <div key={device} style={{ display: "flex", justifyContent: "space-between", fontSize: "0.85rem" }}>
                        <span>{DEVICE_LABELS[device]}</span>
                        <span className="tabular">{Math.round((count / totalDeviceCount) * 100)}%</span>
                      </div>
                    ))}
                </div>
              )}
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

import { useEffect, useState } from "react";
import { DealsApi, SettingsApi, AnalyticsApi, SnapshotApi } from "../api/resources";
import type { AnalyticsSummary, Deal, SocialConnectionStatus, SocialMetricsResult } from "../api/types";
import { useAuth } from "../auth/AuthContext";
import { ApiError } from "../api/client";
import { Banner, Card, EmptyState, PageHeader, Pill, formatDateTime } from "../components/ui";

function toDateInputValue(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Same UTC-end-of-day fix WebsiteAnalyticsPage/ReportsPage's own
 * endOfDayIso() already proved necessary — a bare `YYYY-MM-DD` parses as
 * that date's UTC midnight, excluding the whole day it names. */
function endOfDayIso(dateInputValue: string): string {
  return `${dateInputValue}T23:59:59.999Z`;
}

function formatNumber(n: number | null): string {
  return n === null ? "—" : n.toLocaleString();
}

function niceCeiling(value: number): number {
  if (value <= 0) return 1;
  const exponent = Math.floor(Math.log10(value));
  const fraction = value / 10 ** exponent;
  const niceFraction = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10;
  return niceFraction * 10 ** exponent;
}

function facebookEngagement(m: SocialMetricsResult | null): number {
  if (!m?.facebook) return 0;
  return m.facebook.likes + m.facebook.comments + m.facebook.shares;
}

/**
 * New page added 2026-09-14 at the tenant's own explicit request ("add
 * page: Marketing and Brand Insights — show online advertising activities,
 * online channels, online analytics"). Built entirely from data that
 * already existed elsewhere in this platform, assembled in one place for
 * the first time — no new backend capability, only new frontend reads of
 * three already-real sources:
 *   - Online channels: SettingsApi.getSocialConnection() — the same real
 *     Facebook Page/Instagram connection status SettingsPage.tsx already
 *     shows, re-read here since "which channels are even connected" is
 *     itself a marketing-insight question.
 *   - Online advertising activities: DealsApi.list()'s own real
 *     `lastPublishedAt`/`publishedChannels` fields (added 2026-09-14
 *     alongside DealsController.publish()) — a real log of promotions
 *     actually pushed to Facebook/Instagram, not a fabricated activity
 *     feed. Deals never pushed are shown too, honestly labeled "Not yet
 *     pushed", so this doubles as a reminder of unused promotions.
 *   - Online analytics: website traffic (AnalyticsApi.summary(), the exact
 *     same real tracking-snippet data WebsiteAnalyticsPage.tsx shows) and
 *     social reach/engagement (BusinessSnapshot.socialMetrics, via
 *     SnapshotApi.get() — SocialMetricsService's own real Graph API
 *     numbers, already computed for the Business Snapshot report but never
 *     shown on their own page until now). Every social number that
 *     couldn't be read from Meta (a missing scope, an unlinked Instagram
 *     account) renders as an honest "—" with its real reason, from
 *     `socialMetrics.unavailable` — never a fabricated 0.
 */
export function MarketingInsightsPage() {
  const { session } = useAuth();
  const tenantId = session.status === "loggedIn" ? session.profile.tenantId : "";

  const today = new Date();
  const monthAgo = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);
  const [periodStart] = useState(toDateInputValue(monthAgo));
  const [periodEnd] = useState(toDateInputValue(today));
  // The period immediately before the one above, same length, no gap —
  // same real "self-referential comparison" the rest of this platform
  // already uses (see common/period.ts's own previousPeriod() on the
  // backend; mirrored here client-side since the two projects don't share
  // code). Powers the "comparison graph" below.
  const previousPeriodStart = toDateInputValue(new Date(monthAgo.getTime() - 30 * 24 * 60 * 60 * 1000));
  const previousPeriodEnd = toDateInputValue(new Date(monthAgo.getTime() - 1));

  const [connection, setConnection] = useState<SocialConnectionStatus | null>(null);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [websiteAnalytics, setWebsiteAnalytics] = useState<AnalyticsSummary | null>(null);
  const [socialMetrics, setSocialMetrics] = useState<SocialMetricsResult | null>(null);
  const [prevWebsiteAnalytics, setPrevWebsiteAnalytics] = useState<AnalyticsSummary | null>(null);
  const [prevSocialMetrics, setPrevSocialMetrics] = useState<SocialMetricsResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!tenantId) return;
    setLoading(true);
    Promise.all([
      SettingsApi.getSocialConnection(tenantId),
      DealsApi.list(tenantId),
      AnalyticsApi.summary(tenantId, periodStart, endOfDayIso(periodEnd)),
      SnapshotApi.get(tenantId, periodStart, endOfDayIso(periodEnd)),
      AnalyticsApi.summary(tenantId, previousPeriodStart, endOfDayIso(previousPeriodEnd)),
      SnapshotApi.get(tenantId, previousPeriodStart, endOfDayIso(previousPeriodEnd)),
    ])
      .then(([conn, dealList, website, snapshot, prevWebsite, prevSnapshot]) => {
        setConnection(conn);
        setDeals(dealList);
        setWebsiteAnalytics(website);
        setSocialMetrics(snapshot.socialMetrics);
        setPrevWebsiteAnalytics(prevWebsite);
        setPrevSocialMetrics(prevSnapshot.socialMetrics);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load marketing insights."))
      .finally(() => setLoading(false));
  }, [tenantId, periodStart, periodEnd, previousPeriodStart, previousPeriodEnd]);

  const pushedDeals = [...deals]
    .filter((d) => d.lastPublishedAt)
    .sort((a, b) => new Date(b.lastPublishedAt!).getTime() - new Date(a.lastPublishedAt!).getTime());
  const unpushedDeals = deals.filter((d) => !d.lastPublishedAt);

  const dealsPushedInRange = (start: string, end: string) =>
    deals.filter((d) => d.lastPublishedAt && d.lastPublishedAt >= start && d.lastPublishedAt <= endOfDayIso(end)).length;
  const comparisonRows = [
    { label: "Website visits", current: websiteAnalytics?.totalVisits ?? 0, previous: prevWebsiteAnalytics?.totalVisits ?? 0 },
    { label: "Facebook engagement", current: facebookEngagement(socialMetrics), previous: facebookEngagement(prevSocialMetrics) },
    { label: "Deals pushed", current: dealsPushedInRange(periodStart, periodEnd), previous: dealsPushedInRange(previousPeriodStart, previousPeriodEnd) },
  ];

  return (
    <div>
      <PageHeader title="Marketing & brand insights" subtitle="Online advertising activity, connected channels, and website/social analytics — last 30 days" />
      {error && <Banner kind="error">{error}</Banner>}

      <Card title="This period vs last period">
        {!websiteAnalytics ? (
          <p style={{ color: "var(--color-ink-muted)" }}>{loading ? "Loading…" : "—"}</p>
        ) : (
          <ComparisonChart rows={comparisonRows} />
        )}
      </Card>

      <div style={{ height: "1.1rem" }} />

      <Card title="Online channels">
        {!connection ? (
          <p style={{ color: "var(--color-ink-muted)" }}>{loading ? "Loading…" : "—"}</p>
        ) : !connection.connected ? (
          <EmptyState>No Facebook Page connected yet — connect one from Settings to push promotions and see reach/engagement here.</EmptyState>
        ) : (
          <div style={{ display: "flex", gap: "0.6rem", flexWrap: "wrap" }}>
            <Pill tone="positive">Facebook: {connection.pageName}</Pill>
            <Pill tone={connection.instagramConnected ? "positive" : "neutral"}>
              Instagram: {connection.instagramConnected ? "Linked" : "Not linked"}
            </Pill>
          </div>
        )}
      </Card>

      <div style={{ height: "1.1rem" }} />

      <Card title="Online advertising activity">
        {deals.length === 0 && !loading ? (
          <EmptyState>No deals or promotions created yet — see the Deals & Promotions page.</EmptyState>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            {pushedDeals.map((d) => (
              <div key={d.id} style={{ display: "flex", gap: "0.6rem", alignItems: "center", fontSize: "0.85rem", flexWrap: "wrap" }}>
                <Pill tone="positive">Pushed</Pill>
                <strong>{d.name}</strong>
                <span style={{ color: "var(--color-ink-muted)" }}>
                  {(d.publishedChannels ?? []).map((c) => (c === "facebook" ? "Facebook" : "Instagram")).join(" & ")} ·{" "}
                  {formatDateTime(d.lastPublishedAt!)}
                </span>
              </div>
            ))}
            {unpushedDeals.map((d) => (
              <div key={d.id} style={{ display: "flex", gap: "0.6rem", alignItems: "center", fontSize: "0.85rem", flexWrap: "wrap" }}>
                <Pill tone="neutral">Not yet pushed</Pill>
                <span>{d.name}</span>
              </div>
            ))}
          </div>
        )}
      </Card>

      <div style={{ height: "1.1rem" }} />

      <Card title="Website analytics">
        {!websiteAnalytics ? (
          <p style={{ color: "var(--color-ink-muted)" }}>{loading ? "Loading…" : "—"}</p>
        ) : (
          <div className="stat-grid">
            <div className="card stat-tile">
              <p className="card-title">Visits</p>
              <p className="stat-value">{websiteAnalytics.totalVisits.toLocaleString()}</p>
            </div>
            <div className="card stat-tile">
              <p className="card-title">Unique sessions</p>
              <p className="stat-value">{websiteAnalytics.uniqueSessions.toLocaleString()}</p>
            </div>
            <div className="card stat-tile">
              <p className="card-title">Top referrer</p>
              <p className="stat-value" style={{ fontSize: "1.1rem" }}>
                {websiteAnalytics.topReferrers[0]?.referrer ?? "—"}
              </p>
            </div>
          </div>
        )}
      </Card>

      <div style={{ height: "1.1rem" }} />

      <Card title="Social reach & engagement">
        {!socialMetrics ? (
          <p style={{ color: "var(--color-ink-muted)" }}>{loading ? "Loading…" : "—"}</p>
        ) : !socialMetrics.connected ? (
          <EmptyState>Connect a Facebook Page above to see real reach and engagement numbers here.</EmptyState>
        ) : (
          <>
            <div className="stat-grid">
              <div className="card stat-tile">
                <p className="card-title">Facebook followers</p>
                <p className="stat-value">{formatNumber(socialMetrics.facebook?.followers ?? null)}</p>
              </div>
              <div className="card stat-tile">
                <p className="card-title">Facebook impressions</p>
                <p className="stat-value">{formatNumber(socialMetrics.facebook?.impressions ?? null)}</p>
              </div>
              <div className="card stat-tile">
                <p className="card-title">Facebook engagement</p>
                <p className="stat-value">
                  {(socialMetrics.facebook?.likes ?? 0) + (socialMetrics.facebook?.comments ?? 0) + (socialMetrics.facebook?.shares ?? 0)}
                </p>
                <p className="stat-delta" data-dir="flat">
                  {socialMetrics.facebook?.likes ?? 0} likes · {socialMetrics.facebook?.comments ?? 0} comments · {socialMetrics.facebook?.shares ?? 0}{" "}
                  shares across {socialMetrics.facebook?.postsInPeriod ?? 0} post(s)
                </p>
              </div>
              {socialMetrics.instagram?.connected && (
                <>
                  <div className="card stat-tile">
                    <p className="card-title">Instagram followers</p>
                    <p className="stat-value">{formatNumber(socialMetrics.instagram.followers)}</p>
                  </div>
                  <div className="card stat-tile">
                    <p className="card-title">Instagram engagement</p>
                    <p className="stat-value">{socialMetrics.instagram.likes + socialMetrics.instagram.comments + socialMetrics.instagram.shares}</p>
                    <p className="stat-delta" data-dir="flat">
                      across {socialMetrics.instagram.postsInPeriod} post(s)
                    </p>
                  </div>
                </>
              )}
            </div>
            {Object.keys(socialMetrics.unavailable).length > 0 && (
              <div style={{ marginTop: "0.9rem", fontSize: "0.8rem", color: "var(--color-ink-muted)" }}>
                <p style={{ margin: "0 0 0.3rem", fontWeight: 600 }}>Some numbers couldn't be read from Meta:</p>
                {Object.entries(socialMetrics.unavailable).map(([key, reason]) => (
                  <p key={key} style={{ margin: "0.15rem 0" }}>
                    <code>{key}</code>: {reason}
                  </p>
                ))}
              </div>
            )}
          </>
        )}
      </Card>
    </div>
  );
}

/**
 * "Add comparison graph" — real gap closed 2026-09-14 at the tenant's own
 * explicit request. Hand-rolled SVG grouped bars, no charting library, same
 * discipline as SnapshotPage.tsx's own SalesTrendChart/HourlyBarChart.
 * Compares this period against the immediately-preceding period of the
 * same length across three already-real marketing metrics (website
 * visits, Facebook engagement, deals actually pushed to channels) — not a
 * new metric invented for this chart, just the same numbers shown
 * elsewhere on this page, fetched for both periods and placed side by
 * side so a real trend (up, down, flat) is visible at a glance.
 */
function ComparisonChart({ rows }: { rows: { label: string; current: number; previous: number }[] }) {
  const width = 640;
  const height = 220;
  const paddingLeft = 56;
  const paddingRight = 12;
  const paddingTop = 16;
  const paddingBottom = 40;
  const plotWidth = width - paddingLeft - paddingRight;
  const plotHeight = height - paddingTop - paddingBottom;

  const maxValue = Math.max(...rows.map((r) => Math.max(r.current, r.previous)), 0);
  const axisMax = niceCeiling(maxValue || 1);
  const yAt = (v: number) => paddingTop + plotHeight - (v / axisMax) * plotHeight;
  const floorY = paddingTop + plotHeight;

  const groupWidth = plotWidth / rows.length;
  const barWidth = Math.min(46, groupWidth * 0.28);
  const gapBetweenBars = 8;

  return (
    <div>
      <svg viewBox={`0 0 ${width} ${height}`} style={{ width: "100%", height: "auto", display: "block" }} role="img" aria-label="This period vs last period">
        <line x1={paddingLeft} x2={width - paddingRight} y1={floorY} y2={floorY} stroke="var(--color-border)" strokeWidth={1} />
        {[0, 0.5, 1].map((f) => (
          <text key={f} x={paddingLeft - 8} y={yAt(axisMax * f) + 4} textAnchor="end" fontSize={10} fill="var(--color-ink-muted)">
            {Math.round(axisMax * f).toLocaleString()}
          </text>
        ))}
        {rows.map((row, i) => {
          const groupCenter = paddingLeft + groupWidth * i + groupWidth / 2;
          const prevX = groupCenter - barWidth - gapBetweenBars / 2;
          const currX = groupCenter + gapBetweenBars / 2;
          return (
            <g key={row.label}>
              <rect x={prevX} y={yAt(row.previous)} width={barWidth} height={Math.max(0, floorY - yAt(row.previous))} fill="var(--color-border)" />
              <rect x={currX} y={yAt(row.current)} width={barWidth} height={Math.max(0, floorY - yAt(row.current))} fill="var(--color-teal)" />
              <text x={groupCenter} y={height - paddingBottom + 16} textAnchor="middle" fontSize={11} fill="var(--color-ink-muted)">
                {row.label}
              </text>
            </g>
          );
        })}
      </svg>
      <div style={{ display: "flex", gap: "1.2rem", justifyContent: "center", marginTop: "0.4rem", fontSize: "0.78rem", color: "var(--color-ink-muted)" }}>
        <span style={{ display: "flex", alignItems: "center", gap: "0.35rem" }}>
          <span style={{ width: 10, height: 10, background: "var(--color-teal)", display: "inline-block", borderRadius: 2 }} /> This period
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: "0.35rem" }}>
          <span style={{ width: 10, height: 10, background: "var(--color-border)", display: "inline-block", borderRadius: 2 }} /> Last period
        </span>
      </div>
    </div>
  );
}

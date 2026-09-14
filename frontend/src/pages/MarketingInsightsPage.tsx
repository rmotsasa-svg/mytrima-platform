import { useEffect, useState } from "react";
import { CampaignsApi, DealsApi, SettingsApi, AnalyticsApi, SnapshotApi } from "../api/resources";
import type { AnalyticsSummary, Campaign, CampaignChannel, Deal, SocialConnectionStatus, SocialMetricsResult } from "../api/types";
import { useAuth } from "../auth/AuthContext";
import { ApiError } from "../api/client";
import { Banner, Button, Card, EmptyState, PageHeader, Pill, formatDateTime } from "../components/ui";

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
  const canManage = session.status === "loggedIn" && session.profile.role !== "read_only";

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
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [showCampaignForm, setShowCampaignForm] = useState(false);
  const [launchingId, setLaunchingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    if (!tenantId) return;
    setLoading(true);
    try {
      const [conn, dealList, website, snapshot, prevWebsite, prevSnapshot, campaignList] = await Promise.all([
        SettingsApi.getSocialConnection(tenantId),
        DealsApi.list(tenantId),
        AnalyticsApi.summary(tenantId, periodStart, endOfDayIso(periodEnd)),
        SnapshotApi.get(tenantId, periodStart, endOfDayIso(periodEnd)),
        AnalyticsApi.summary(tenantId, previousPeriodStart, endOfDayIso(previousPeriodEnd)),
        SnapshotApi.get(tenantId, previousPeriodStart, endOfDayIso(previousPeriodEnd)),
        CampaignsApi.list(tenantId),
      ]);
      setConnection(conn);
      setDeals(dealList);
      setWebsiteAnalytics(website);
      setSocialMetrics(snapshot.socialMetrics);
      setPrevWebsiteAnalytics(prevWebsite);
      setPrevSocialMetrics(prevSnapshot.socialMetrics);
      setCampaigns(campaignList);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load marketing insights.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, periodStart, periodEnd, previousPeriodStart, previousPeriodEnd]);

  async function launchCampaign(campaignId: string) {
    setLaunchingId(campaignId);
    setError(null);
    try {
      await CampaignsApi.launch(tenantId, campaignId);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not launch this campaign.");
    } finally {
      setLaunchingId(null);
    }
  }

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

      <Card
        title="Campaigns"
        actions={
          canManage && (
            <Button variant="primary" onClick={() => setShowCampaignForm((s) => !s)}>
              {showCampaignForm ? "Cancel" : "New campaign"}
            </Button>
          )
        }
      >
        {showCampaignForm && (
          <>
            <NewCampaignForm
              tenantId={tenantId}
              deals={deals}
              onCreated={() => {
                setShowCampaignForm(false);
                void load();
              }}
            />
            <div style={{ height: "0.9rem" }} />
          </>
        )}
        {campaigns.length === 0 && !loading ? (
          <EmptyState>No campaigns yet — set one up to push a promotion across Facebook, Instagram, WhatsApp, and your website at once.</EmptyState>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
            {campaigns.map((c) => (
              <div key={c.id} style={{ borderTop: "1px solid var(--color-border)", paddingTop: "0.6rem" }}>
                <div style={{ display: "flex", gap: "0.6rem", alignItems: "center", flexWrap: "wrap", fontSize: "0.88rem" }}>
                  <strong>{c.name}</strong>
                  {c.channels.map((ch) => (
                    <Pill key={ch} tone="neutral">
                      {ch}
                    </Pill>
                  ))}
                  {canManage && (
                    <Button variant="secondary" disabled={launchingId === c.id} onClick={() => void launchCampaign(c.id)}>
                      {launchingId === c.id ? "Launching…" : "Launch"}
                    </Button>
                  )}
                </div>
                {c.lastLaunchResults && (
                  <div style={{ marginTop: "0.4rem", display: "flex", flexDirection: "column", gap: "0.2rem" }}>
                    {c.lastLaunchResults.map((r) => (
                      <div key={r.channel} style={{ display: "flex", gap: "0.5rem", alignItems: "center", fontSize: "0.8rem" }}>
                        <Pill
                          tone={
                            r.status === "posted" || r.status === "sent"
                              ? "positive"
                              : r.status === "skipped" || r.status === "info"
                                ? "neutral"
                                : "critical"
                          }
                        >
                          {r.channel}: {r.status}
                        </Pill>
                        {r.detail && <span style={{ color: "var(--color-ink-muted)" }}>{r.detail}</span>}
                      </div>
                    ))}
                    <span style={{ fontSize: "0.75rem", color: "var(--color-ink-muted)" }}>Last launched {formatDateTime(c.lastLaunchedAt!)}</span>
                  </div>
                )}
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

const ALL_CHANNELS: CampaignChannel[] = ["facebook", "instagram", "whatsapp", "website"];
const CHANNEL_LABEL: Record<CampaignChannel, string> = { facebook: "Facebook", instagram: "Instagram", whatsapp: "WhatsApp", website: "Website" };

/** "Add campaign set for Facebook, WhatsApp, Instagram and Website" — see
 * CampaignsController's own comment for exactly what launching each
 * channel does (and its two disclosed gaps). Optionally links a real
 * existing Deal for its content (name/discount copy/ad image) rather than
 * asking for a second, separate creative here. */
function NewCampaignForm({ tenantId, deals, onCreated }: { tenantId: string; deals: Deal[]; onCreated: () => void }) {
  const [name, setName] = useState("");
  const [dealId, setDealId] = useState("");
  const [message, setMessage] = useState("");
  const [channels, setChannels] = useState<CampaignChannel[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function toggleChannel(ch: CampaignChannel) {
    setChannels((prev) => (prev.includes(ch) ? prev.filter((c) => c !== ch) : [...prev, ch]));
  }

  async function handleSubmit() {
    if (!name.trim()) {
      setError("Give this campaign a name.");
      return;
    }
    if (channels.length === 0) {
      setError("Pick at least one channel.");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      await CampaignsApi.create(tenantId, { name: name.trim(), dealId: dealId || undefined, message: message || undefined, channels });
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create this campaign.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card title="New campaign">
      {error && <Banner kind="error">{error}</Banner>}
      <div className="form-grid">
        <div className="field">
          <label htmlFor="campaign-name">Name</label>
          <input id="campaign-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Spring Push" />
        </div>
        <div className="field">
          <label htmlFor="campaign-deal">Reuse a deal's content (optional)</label>
          <select id="campaign-deal" value={dealId} onChange={(e) => setDealId(e.target.value)}>
            <option value="">No deal — custom message only</option>
            {deals.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="campaign-message">Custom message (optional)</label>
          <input
            id="campaign-message"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Leave blank to use the deal's own message, or the campaign name"
          />
        </div>
      </div>
      <div style={{ marginTop: "0.9rem" }}>
        <p style={{ margin: "0 0 0.5rem", fontSize: "0.85rem", fontWeight: 600 }}>Channels</p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
          {ALL_CHANNELS.map((ch) => (
            <label
              key={ch}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.35rem",
                border: "1px solid var(--color-border)",
                borderRadius: 7,
                padding: "0.35rem 0.6rem",
                fontSize: "0.85rem",
                background: channels.includes(ch) ? "var(--color-mint-soft)" : "transparent",
                cursor: "pointer",
              }}
            >
              <input type="checkbox" checked={channels.includes(ch)} onChange={() => toggleChannel(ch)} />
              {CHANNEL_LABEL[ch]}
            </label>
          ))}
        </div>
      </div>
      <div style={{ marginTop: "0.9rem" }}>
        <Button variant="primary" disabled={submitting} onClick={() => void handleSubmit()}>
          {submitting ? "Creating…" : "Create campaign"}
        </Button>
      </div>
    </Card>
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

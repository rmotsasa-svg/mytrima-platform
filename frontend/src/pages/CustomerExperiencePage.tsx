import { useEffect, useState } from "react";
import { NpsApi, RatingsApi } from "../api/resources";
import type { NpsAggregate, NpsResponse, Rating, RatingAggregate, RatingStatus } from "../api/types";
import { useAuth } from "../auth/AuthContext";
import { ApiError } from "../api/client";
import { Banner, Button, Card, EmptyState, PageHeader, Pill, formatDateTime } from "../components/ui";

/** Mirrors nps.service.ts's own categorize() (score <=6 detractor, <=8
 * passive, else promoter) — the list endpoint returns raw scores, not a
 * precomputed category, so this SPA classifies them the same way the
 * backend does rather than inventing its own thresholds. */
function npsCategory(score: number): "promoter" | "passive" | "detractor" {
  if (score <= 6) return "detractor";
  if (score <= 8) return "passive";
  return "promoter";
}

const RATING_STATUS_TONE: Record<RatingStatus, "positive" | "attention" | "critical" | "neutral" | "gold"> = {
  pending: "gold",
  public: "positive",
  hidden: "critical",
};

const NPS_CATEGORY_TONE: Record<"promoter" | "passive" | "detractor", "positive" | "attention" | "critical" | "neutral" | "gold"> = {
  promoter: "positive",
  passive: "gold",
  detractor: "critical",
};

export function CustomerExperiencePage() {
  const { session } = useAuth();
  const tenantId = session.status === "loggedIn" ? session.profile.tenantId : "";
  const canModerate = session.status === "loggedIn" && session.profile.role !== "read_only";

  const [ratings, setRatings] = useState<Rating[]>([]);
  const [ratingAgg, setRatingAgg] = useState<RatingAggregate | null>(null);
  const [npsResponses, setNpsResponses] = useState<NpsResponse[]>([]);
  const [npsAgg, setNpsAgg] = useState<NpsAggregate | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function load() {
    if (!tenantId) return;
    setLoading(true);
    try {
      const [r, ra, n, na] = await Promise.all([
        RatingsApi.list(tenantId),
        RatingsApi.aggregate(tenantId),
        NpsApi.list(tenantId),
        NpsApi.aggregate(tenantId),
      ]);
      setRatings(r);
      setRatingAgg(ra);
      setNpsResponses(n);
      setNpsAgg(na);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load customer experience data.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  async function moderate(ratingId: string, status: "public" | "hidden") {
    setBusyId(ratingId);
    setError(null);
    try {
      await RatingsApi.moderate(ratingId, status);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not moderate this rating.");
    } finally {
      setBusyId(null);
    }
  }

  const sortedRatings = [...ratings].sort((a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime());
  const sortedNps = [...npsResponses].sort((a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime());
  const pendingCount = ratings.filter((r) => r.status === "pending").length;

  return (
    <div>
      <PageHeader
        title="Customer experience"
        subtitle="What customers actually said — star ratings and NPS surveys, submitted directly by them, no Mytrima account needed."
      />
      {error && <Banner kind="error">{error}</Banner>}

      <div className="stat-grid">
        <div className="card stat-tile">
          <p className="card-title">Public rating (moderated only)</p>
          <p className="stat-value">{ratingAgg ? (ratingAgg.count === 0 ? "—" : `${ratingAgg.averageStars.toFixed(1)} / 5`) : "—"}</p>
          <p className="stat-delta" data-dir="flat">
            {ratingAgg?.count ?? 0} public review{ratingAgg?.count === 1 ? "" : "s"}
            {pendingCount > 0 ? ` · ${pendingCount} awaiting moderation` : ""}
          </p>
        </div>
        <div className="card stat-tile">
          <p className="card-title">Net Promoter Score</p>
          <p className="stat-value">{npsAgg && npsAgg.count > 0 ? npsAgg.nps.toFixed(0) : "—"}</p>
          <p className="stat-delta" data-dir="flat">
            {npsAgg?.count ?? 0} response{npsAgg?.count === 1 ? "" : "s"}
          </p>
        </div>
      </div>

      <div style={{ height: "1.3rem" }} />

      <Card title={`Ratings${pendingCount > 0 ? ` — ${pendingCount} pending` : ""}`}>
        <p style={{ marginTop: 0, fontSize: "0.85rem", color: "var(--color-ink-muted)" }}>
          A new rating starts <Pill tone="gold">pending</Pill> — only <Pill tone="positive">public</Pill> ratings count toward the average above, so a customer's
          review never moves that number until someone reviews it first.
        </p>
        {!loading && sortedRatings.length === 0 ? (
          <EmptyState>No ratings submitted yet.</EmptyState>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.65rem" }}>
            {sortedRatings.map((r) => (
              <div key={r.id} className="card" style={{ padding: "0.85rem 1rem" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "0.75rem", flexWrap: "wrap" }}>
                  <div>
                    <strong className="tabular">{"★".repeat(r.stars)}</strong>
                    <span style={{ color: "var(--color-ink-muted)" }}> {"☆".repeat(5 - r.stars)}</span>
                    {r.comment && <p style={{ margin: "0.3rem 0 0", fontSize: "0.88rem" }}>{r.comment}</p>}
                    <p style={{ margin: "0.3rem 0 0", fontSize: "0.76rem", color: "var(--color-ink-muted)" }}>
                      Customer {r.customerId} · {formatDateTime(r.submittedAt)}
                    </p>
                  </div>
                  <div style={{ display: "flex", gap: "0.4rem", alignItems: "center", flexShrink: 0 }}>
                    <Pill tone={RATING_STATUS_TONE[r.status]}>{r.status}</Pill>
                    {canModerate && r.status !== "public" && (
                      <Button variant="primary" disabled={busyId === r.id} onClick={() => void moderate(r.id, "public")}>
                        Publish
                      </Button>
                    )}
                    {canModerate && r.status !== "hidden" && (
                      <Button variant="secondary" disabled={busyId === r.id} onClick={() => void moderate(r.id, "hidden")}>
                        Hide
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <div style={{ height: "1.3rem" }} />

      <Card title="NPS responses">
        {!loading && sortedNps.length === 0 ? (
          <EmptyState>No NPS responses submitted yet.</EmptyState>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.65rem" }}>
            {sortedNps.map((n) => {
              const category = npsCategory(n.score);
              return (
                <div key={n.id} className="card" style={{ padding: "0.85rem 1rem" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "0.75rem", flexWrap: "wrap" }}>
                    <div>
                      <strong className="tabular">{n.score}/10</strong>
                      {n.comment && <p style={{ margin: "0.3rem 0 0", fontSize: "0.88rem" }}>{n.comment}</p>}
                      <p style={{ margin: "0.3rem 0 0", fontSize: "0.76rem", color: "var(--color-ink-muted)" }}>
                        Customer {n.customerId} · {formatDateTime(n.submittedAt)}
                      </p>
                    </div>
                    <Pill tone={NPS_CATEGORY_TONE[category]}>{category}</Pill>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}

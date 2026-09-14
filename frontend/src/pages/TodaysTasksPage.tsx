import { useEffect, useState } from "react";
import { BookingsApi, CustomersApi, NpsApi, RatingsApi, SnapshotApi } from "../api/resources";
import type { Booking, Customer, NpsResponse, Rating, SnapshotActionItem } from "../api/types";
import { useAuth } from "../auth/AuthContext";
import { ApiError } from "../api/client";
import { Banner, Button, Card, EmptyState, PageHeader, Pill, formatDateTime } from "../components/ui";

/** Mirrors nps.service.ts's own categorize()/needsFollowUp() — a detractor
 * is score <= 6. Duplicated here rather than imported (this SPA has no
 * shared package with the backend) — same reasoning
 * CustomerExperiencePage.tsx's own npsCategory() already documents. */
function isDetractor(score: number): boolean {
  return score <= 6;
}

/**
 * New page added 2026-09-14 at the tenant's own explicit request ("add new
 * page: Today's Task which shall be influenced by engine triggers"). Built
 * entirely from real signals that already existed elsewhere in this
 * platform — no new backend capability, no fabricated "task" concept with
 * its own fake completion state that could drift from reality. Each
 * section below IS one of this platform's own real "engine triggers":
 *
 *   - Booking requests awaiting a decision — BookingsApi.list(), filtered
 *     to `status === "requested"`. Confirm/Decline here call the exact
 *     same real endpoints BookingsPage.tsx itself uses — completing a task
 *     here really does resolve it there too, since it's the same data.
 *   - Ratings awaiting moderation — RatingsApi.list(), filtered to
 *     `status === "pending"`. Publish/Hide call the real moderate()
 *     endpoint, same as CustomerExperiencePage.tsx.
 *   - Customers who may need a follow-up — real NPS detractors
 *     (score <= 6, same threshold nps.service.ts's own needsFollowUp()
 *     uses) from NpsApi.list(). Informational only: this platform has no
 *     single "resolve this detractor" action to complete, unlike a
 *     booking or a rating.
 *   - Growth recommendations — the real, already-computed
 *     `BusinessSnapshot.actionPlan` (the Growth Audit recommendation
 *     engine's own output, the same real
 *     literal card `SnapshotPage.tsx`'s "Recommended next steps" already
 *     shows) — the one genuine "engine" among these triggers.
 *
 * A task resolved elsewhere in the app (a booking confirmed from
 * BookingsPage.tsx, say) simply stops appearing here on next load — there
 * is no separate "mark done" state to fall out of sync with what's real.
 */
export function TodaysTasksPage() {
  const { session } = useAuth();
  const tenantId = session.status === "loggedIn" ? session.profile.tenantId : "";
  const canManage = session.status === "loggedIn" && session.profile.role !== "read_only";

  const [bookings, setBookings] = useState<Booking[]>([]);
  const [ratings, setRatings] = useState<Rating[]>([]);
  const [npsResponses, setNpsResponses] = useState<NpsResponse[]>([]);
  const [actionPlan, setActionPlan] = useState<SnapshotActionItem[]>([]);
  const [customers, setCustomers] = useState<Record<string, Customer>>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function load() {
    if (!tenantId) return;
    setLoading(true);
    try {
      const today = new Date();
      const monthAgo = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);
      const [bookingList, ratingList, npsList, snapshot, customerList] = await Promise.all([
        BookingsApi.list(tenantId),
        RatingsApi.list(tenantId),
        NpsApi.list(tenantId),
        SnapshotApi.get(tenantId, monthAgo.toISOString(), today.toISOString()),
        CustomersApi.list(tenantId),
      ]);
      setBookings(bookingList);
      setRatings(ratingList);
      setNpsResponses(npsList);
      setActionPlan(snapshot.actionPlan);
      setCustomers(Object.fromEntries(customerList.map((c) => [c.id, c])));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load today's tasks.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  function customerName(customerId: string): string {
    const c = customers[customerId];
    return c?.displayName ?? c?.phone ?? c?.email ?? customerId;
  }

  async function actOnBooking(bookingId: string, action: "confirm" | "cancel") {
    setBusyId(bookingId);
    setError(null);
    try {
      await BookingsApi[action](tenantId, bookingId);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not update this booking.");
    } finally {
      setBusyId(null);
    }
  }

  async function moderateRating(ratingId: string, status: "public" | "hidden") {
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

  const requestedBookings = bookings
    .filter((b) => b.status === "requested")
    .sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime());
  const pendingRatings = ratings.filter((r) => r.status === "pending").sort((a, b) => new Date(a.submittedAt).getTime() - new Date(b.submittedAt).getTime());
  const detractors = npsResponses
    .filter((n) => isDetractor(n.score))
    .sort((a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime());

  const totalTasks = requestedBookings.length + pendingRatings.length;

  return (
    <div>
      <PageHeader
        title="Today's tasks"
        subtitle={
          loading
            ? "Loading…"
            : totalTasks === 0
              ? "Nothing needs your attention right now."
              : `${totalTasks} item${totalTasks === 1 ? "" : "s"} need${totalTasks === 1 ? "s" : ""} a decision`
        }
      />
      {error && <Banner kind="error">{error}</Banner>}

      <Card title="Booking requests awaiting a decision">
        {requestedBookings.length === 0 ? (
          <EmptyState>No pending booking requests.</EmptyState>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
            {requestedBookings.map((b) => (
              <div key={b.id} style={{ display: "flex", gap: "0.75rem", alignItems: "center", flexWrap: "wrap", fontSize: "0.88rem" }}>
                <Pill tone="gold">Requested</Pill>
                <strong>{customerName(b.customerId)}</strong>
                <span style={{ color: "var(--color-ink-muted)" }}>{formatDateTime(b.scheduledAt)}</span>
                {canManage && (
                  <div style={{ display: "flex", gap: "0.4rem" }}>
                    <Button variant="primary" disabled={busyId === b.id} onClick={() => void actOnBooking(b.id, "confirm")}>
                      Confirm
                    </Button>
                    <Button variant="danger" disabled={busyId === b.id} onClick={() => void actOnBooking(b.id, "cancel")}>
                      Decline
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      <div style={{ height: "1.1rem" }} />

      <Card title="Ratings awaiting moderation">
        {pendingRatings.length === 0 ? (
          <EmptyState>No ratings waiting to be moderated.</EmptyState>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
            {pendingRatings.map((r) => (
              <div key={r.id} style={{ display: "flex", gap: "0.75rem", alignItems: "center", flexWrap: "wrap", fontSize: "0.88rem" }}>
                <span>{"★".repeat(r.stars)}</span>
                <strong>{customerName(r.customerId)}</strong>
                {r.comment && <span style={{ color: "var(--color-ink-muted)" }}>"{r.comment}"</span>}
                {canManage && (
                  <div style={{ display: "flex", gap: "0.4rem" }}>
                    <Button variant="primary" disabled={busyId === r.id} onClick={() => void moderateRating(r.id, "public")}>
                      Publish
                    </Button>
                    <Button variant="danger" disabled={busyId === r.id} onClick={() => void moderateRating(r.id, "hidden")}>
                      Hide
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      <div style={{ height: "1.1rem" }} />

      <Card title="Customers who may need a follow-up">
        {detractors.length === 0 ? (
          <EmptyState>No recent NPS detractors (score 6 or below) — nothing to follow up on.</EmptyState>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            {detractors.map((n) => (
              <div key={n.id} style={{ display: "flex", gap: "0.75rem", alignItems: "center", flexWrap: "wrap", fontSize: "0.85rem" }}>
                <Pill tone="critical">NPS {n.score}</Pill>
                <strong>{customerName(n.customerId)}</strong>
                {n.comment && <span style={{ color: "var(--color-ink-muted)" }}>"{n.comment}"</span>}
                <span style={{ color: "var(--color-ink-muted)" }}>{formatDateTime(n.submittedAt)}</span>
              </div>
            ))}
          </div>
        )}
      </Card>

      <div style={{ height: "1.1rem" }} />

      <Card title="Growth recommendations">
        {actionPlan.length === 0 ? (
          <EmptyState>No growth recommendations yet — submit a Growth Audit to get real, ranked suggestions here.</EmptyState>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
            {actionPlan.map((item, i) => (
              <div key={i} style={{ display: "flex", gap: "0.6rem", alignItems: "flex-start", flexWrap: "wrap", fontSize: "0.88rem" }}>
                <Pill tone={item.category === "quick_win" ? "positive" : "gold"}>{item.category === "quick_win" ? "Quick win" : "Strategic"}</Pill>
                <div>
                  <strong>{item.label}</strong>
                  <p style={{ margin: "0.15rem 0 0", color: "var(--color-ink-muted)" }}>{item.why}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

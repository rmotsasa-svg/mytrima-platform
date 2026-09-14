import { useEffect, useState } from "react";
import { BookingsApi, CustomersApi, GrowthActionsApi, NpsApi, RatingsApi, SnapshotApi } from "../api/resources";
import type { Booking, Customer, GrowthAction, GrowthActionPriority, NpsResponse, Rating, SnapshotActionItem } from "../api/types";
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

const PRIORITY_TONE: Record<GrowthActionPriority, "positive" | "attention" | "critical" | "neutral" | "gold"> = {
  low: "neutral",
  medium: "gold",
  high: "attention",
};

/**
 * Renamed from TodaysTasksPage.tsx in Phase 4 of the GrowthOS-aligned
 * restructuring plan (C:\Users\USER\.claude\plans\twinkly-sprouting-orbit.md).
 * Originally added 2026-09-14 at the tenant's own explicit request ("add
 * new page: Today's Task which shall be influenced by engine triggers"),
 * built entirely from real signals that already existed elsewhere in this
 * platform — no fabricated "task" concept with its own fake completion
 * state that could drift from reality. That discipline is kept exactly as
 * it was for the four DERIVED sections below (bookings/ratings/NPS/audit
 * plan) — none of them gained a stored completion state in this phase,
 * because none of them needed one.
 *
 * What Phase 4 actually adds is the "Growth actions" section at the top: a
 * real GrowthAction entity (src/modules/growth-actions/) with its own
 * genuine lifecycle (todo -> in_progress -> done/dismissed), created either
 * manually here or by converting a Trigger on TriggersPage.tsx. That's the
 * one kind of task this platform genuinely didn't have anywhere to track
 * before — the other four keep reading live off their own real records.
 */
export function GrowthActionsPage() {
  const { session } = useAuth();
  const tenantId = session.status === "loggedIn" ? session.profile.tenantId : "";
  const canManage = session.status === "loggedIn" && session.profile.role !== "read_only";

  const [growthActions, setGrowthActions] = useState<GrowthAction[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [ratings, setRatings] = useState<Rating[]>([]);
  const [npsResponses, setNpsResponses] = useState<NpsResponse[]>([]);
  const [actionPlan, setActionPlan] = useState<SnapshotActionItem[]>([]);
  const [customers, setCustomers] = useState<Record<string, Customer>>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  async function load() {
    if (!tenantId) return;
    setLoading(true);
    try {
      const today = new Date();
      const monthAgo = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);
      const [actionList, bookingList, ratingList, npsList, snapshot, customerList] = await Promise.all([
        GrowthActionsApi.list(tenantId),
        BookingsApi.list(tenantId),
        RatingsApi.list(tenantId),
        NpsApi.list(tenantId),
        SnapshotApi.get(tenantId, monthAgo.toISOString(), today.toISOString()),
        CustomersApi.list(tenantId),
      ]);
      setGrowthActions(actionList);
      setBookings(bookingList);
      setRatings(ratingList);
      setNpsResponses(npsList);
      setActionPlan(snapshot.actionPlan);
      setCustomers(Object.fromEntries(customerList.map((c) => [c.id, c])));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load growth actions.");
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

  async function setActionStatus(actionId: string, status: GrowthAction["status"]) {
    setBusyId(actionId);
    setError(null);
    try {
      await GrowthActionsApi.update(tenantId, actionId, { status });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not update this action.");
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
  const activeActions = growthActions
    .filter((a) => a.status === "todo" || a.status === "in_progress")
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const totalTasks = activeActions.length + requestedBookings.length + pendingRatings.length;

  return (
    <div>
      <PageHeader
        title="Growth actions"
        subtitle={
          loading
            ? "Loading…"
            : totalTasks === 0
              ? "Nothing needs your attention right now."
              : `${totalTasks} item${totalTasks === 1 ? "" : "s"} need${totalTasks === 1 ? "s" : ""} a decision`
        }
        actions={
          canManage && (
            <Button variant="primary" onClick={() => setShowForm((s) => !s)}>
              {showForm ? "Cancel" : "New action"}
            </Button>
          )
        }
      />
      {error && <Banner kind="error">{error}</Banner>}

      {showForm && (
        <>
          <NewGrowthActionForm
            tenantId={tenantId}
            onCreated={() => {
              setShowForm(false);
              void load();
            }}
          />
          <div style={{ height: "1.1rem" }} />
        </>
      )}

      <Card title="Growth actions">
        {activeActions.length === 0 ? (
          <EmptyState>No open growth actions — create one, or convert a trigger from the Triggers page.</EmptyState>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.7rem" }}>
            {activeActions.map((a) => (
              <div key={a.id} style={{ display: "flex", flexDirection: "column", gap: "0.35rem", fontSize: "0.88rem" }}>
                <div style={{ display: "flex", gap: "0.6rem", alignItems: "flex-start", flexWrap: "wrap" }}>
                  <Pill tone={PRIORITY_TONE[a.priority]}>{a.priority}</Pill>
                  <div>
                    <strong>{a.title}</strong>
                    <p style={{ margin: "0.15rem 0 0", color: "var(--color-ink-muted)" }}>
                      {a.reason} · Expected impact: {a.expectedImpact}
                    </p>
                  </div>
                </div>
                {canManage && (
                  <div style={{ display: "flex", gap: "0.4rem" }}>
                    {a.status === "todo" && (
                      <Button variant="secondary" disabled={busyId === a.id} onClick={() => void setActionStatus(a.id, "in_progress")}>
                        Start
                      </Button>
                    )}
                    <Button variant="primary" disabled={busyId === a.id} onClick={() => void setActionStatus(a.id, "done")}>
                      Mark done
                    </Button>
                    <Button variant="ghost" disabled={busyId === a.id} onClick={() => void setActionStatus(a.id, "dismissed")}>
                      Dismiss
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      <div style={{ height: "1.1rem" }} />

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

function NewGrowthActionForm({ tenantId, onCreated }: { tenantId: string; onCreated: () => void }) {
  const [title, setTitle] = useState("");
  const [reason, setReason] = useState("");
  const [expectedImpact, setExpectedImpact] = useState("");
  const [priority, setPriority] = useState<GrowthActionPriority>("medium");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    if (!title.trim() || !reason.trim() || !expectedImpact.trim()) {
      setError("Title, reason, and expected impact are all required.");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      await GrowthActionsApi.create(tenantId, { title: title.trim(), reason: reason.trim(), expectedImpact: expectedImpact.trim(), priority });
      setTitle("");
      setReason("");
      setExpectedImpact("");
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create this action.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card title="New action">
      {error && <Banner kind="error">{error}</Banner>}
      <div className="field" style={{ marginBottom: "0.85rem" }}>
        <label htmlFor="action-title">What should happen</label>
        <input id="action-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Follow up with 5 hot leads" />
      </div>
      <div className="field" style={{ marginBottom: "0.85rem" }}>
        <label htmlFor="action-reason">Why</label>
        <input id="action-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="5 qualified leads haven't been contacted" />
      </div>
      <div className="form-grid">
        <div className="field">
          <label htmlFor="action-impact">Expected impact</label>
          <input id="action-impact" value={expectedImpact} onChange={(e) => setExpectedImpact(e.target.value)} placeholder="Revenue" />
        </div>
        <div className="field">
          <label htmlFor="action-priority">Priority</label>
          <select id="action-priority" value={priority} onChange={(e) => setPriority(e.target.value as GrowthActionPriority)}>
            <option value="low">low</option>
            <option value="medium">medium</option>
            <option value="high">high</option>
          </select>
        </div>
        <Button variant="primary" disabled={submitting} onClick={() => void handleSubmit()}>
          {submitting ? "Creating…" : "Create action"}
        </Button>
      </div>
    </Card>
  );
}

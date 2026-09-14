import { useEffect, useState } from "react";
import { GoalsApi } from "../api/resources";
import type { Goal, GoalPriority, GoalStatus } from "../api/types";
import { ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { Banner, Button, Card, EmptyState, PageHeader, Pill, formatDateTime } from "../components/ui";

const PRIORITIES: GoalPriority[] = ["low", "medium", "high"];
const STATUSES: GoalStatus[] = ["on_track", "at_risk", "achieved", "abandoned"];

const PRIORITY_TONE: Record<GoalPriority, "positive" | "attention" | "critical" | "neutral" | "gold"> = {
  low: "neutral",
  medium: "gold",
  high: "attention",
};

const STATUS_TONE: Record<GoalStatus, "positive" | "attention" | "critical" | "neutral" | "gold"> = {
  on_track: "positive",
  at_risk: "attention",
  achieved: "gold",
  abandoned: "neutral",
};

/**
 * Phase 3 of the GrowthOS-aligned restructuring plan
 * (C:\Users\USER\.claude\plans\twinkly-sprouting-orbit.md). Every progress
 * bar here renders `progressPct` exactly as the real backend computed it
 * (goal.service.ts's computeProgressPct()) — this page never recomputes
 * or approximates it.
 */
export function GoalsPage() {
  const { session } = useAuth();
  const tenantId = session.status === "loggedIn" ? session.profile.tenantId : "";
  const canManage = session.status === "loggedIn" && session.profile.role !== "read_only";

  const [goals, setGoals] = useState<Goal[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);

  async function load() {
    if (!tenantId) return;
    setLoading(true);
    try {
      setGoals(await GoalsApi.list(tenantId));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load goals.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  const sorted = [...goals].sort((a, b) => new Date(a.deadline).getTime() - new Date(b.deadline).getTime());

  return (
    <div>
      <PageHeader
        title="Goals"
        subtitle="Turn what you're trying to achieve into a real, measurable target — not just an ambition."
        actions={
          canManage && (
            <Button variant="primary" onClick={() => setShowForm((s) => !s)}>
              {showForm ? "Cancel" : "New goal"}
            </Button>
          )
        }
      />

      {error && <Banner kind="error">{error}</Banner>}

      {showForm && (
        <>
          <NewGoalForm
            tenantId={tenantId}
            onCreated={() => {
              setShowForm(false);
              void load();
            }}
          />
          <div style={{ height: "1.1rem" }} />
        </>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
        {sorted.map((g) => (
          <GoalCard key={g.id} goal={g} tenantId={tenantId} canManage={canManage} onChanged={load} />
        ))}
        {!loading && sorted.length === 0 && (
          <div className="card">
            <EmptyState>No goals yet — set one to turn an ambition into something trackable.</EmptyState>
          </div>
        )}
      </div>
    </div>
  );
}

function GoalCard({ goal, tenantId, canManage, onChanged }: { goal: Goal; tenantId: string; canManage: boolean; onChanged: () => void }) {
  const [currentValue, setCurrentValue] = useState(String(goal.currentValue));
  const [status, setStatus] = useState<GoalStatus>(goal.status);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    const parsed = Number(currentValue);
    if (!Number.isFinite(parsed)) {
      setError("Current value must be a real number.");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await GoalsApi.update(tenantId, goal.id, { currentValue: parsed, status });
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not update this goal.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "0.75rem", flexWrap: "wrap" }}>
        <div>
          <strong>{goal.objective}</strong>
          <p style={{ margin: "0.25rem 0 0", fontSize: "0.85rem", color: "var(--color-ink-muted)" }}>{goal.metric}</p>
        </div>
        <div style={{ display: "flex", gap: "0.4rem", flexShrink: 0 }}>
          <Pill tone={PRIORITY_TONE[goal.priority]}>{goal.priority}</Pill>
          <Pill tone={STATUS_TONE[goal.status]}>{goal.status.replace("_", " ")}</Pill>
        </div>
      </div>

      <div
        style={{
          height: 10,
          borderRadius: 999,
          background: "var(--color-surface-sunken)",
          overflow: "hidden",
          margin: "0.7rem 0 0.3rem",
        }}
      >
        <div style={{ height: "100%", width: `${goal.progressPct}%`, background: "var(--color-teal)", transition: "width 0.3s ease" }} />
      </div>
      <p style={{ margin: 0, fontSize: "0.82rem", color: "var(--color-ink-muted)" }}>
        {goal.progressPct.toFixed(0)}% of the way there — {goal.currentValue} of {goal.targetValue} (started at {goal.baselineValue}) · due{" "}
        {formatDateTime(goal.deadline)}
      </p>

      {canManage && (
        <>
          {error && (
            <div style={{ marginTop: "0.6rem" }}>
              <Banner kind="error">{error}</Banner>
            </div>
          )}
          <div className="form-grid" style={{ marginTop: "0.7rem", alignItems: "end" }}>
            <div className="field">
              <label htmlFor={`current-${goal.id}`}>Current value</label>
              <input id={`current-${goal.id}`} value={currentValue} onChange={(e) => setCurrentValue(e.target.value)} inputMode="decimal" />
            </div>
            <div className="field">
              <label htmlFor={`status-${goal.id}`}>Status</label>
              <select id={`status-${goal.id}`} value={status} onChange={(e) => setStatus(e.target.value as GoalStatus)}>
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s.replace("_", " ")}
                  </option>
                ))}
              </select>
            </div>
            <Button variant="secondary" disabled={busy} onClick={() => void save()}>
              {busy ? "Saving…" : "Update progress"}
            </Button>
          </div>
        </>
      )}
    </Card>
  );
}

function NewGoalForm({ tenantId, onCreated }: { tenantId: string; onCreated: () => void }) {
  const [objective, setObjective] = useState("");
  const [metric, setMetric] = useState("");
  const [baselineValue, setBaselineValue] = useState("");
  const [targetValue, setTargetValue] = useState("");
  const [deadline, setDeadline] = useState("");
  const [priority, setPriority] = useState<GoalPriority>("medium");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    const baseline = Number(baselineValue);
    const target = Number(targetValue);
    if (!objective.trim() || !metric.trim() || !deadline) {
      setError("Objective, metric, and deadline are all required.");
      return;
    }
    if (!Number.isFinite(baseline) || !Number.isFinite(target)) {
      setError("Baseline and target must both be real numbers.");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      await GoalsApi.create(tenantId, { objective: objective.trim(), metric: metric.trim(), baselineValue: baseline, targetValue: target, deadline, priority });
      setObjective("");
      setMetric("");
      setBaselineValue("");
      setTargetValue("");
      setDeadline("");
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create this goal.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card title="New goal">
      {error && <Banner kind="error">{error}</Banner>}
      <div className="field" style={{ marginBottom: "0.85rem" }}>
        <label htmlFor="goal-objective">Objective</label>
        <input id="goal-objective" value={objective} onChange={(e) => setObjective(e.target.value)} placeholder="Increase monthly revenue" />
      </div>
      <div className="field" style={{ marginBottom: "0.85rem" }}>
        <label htmlFor="goal-metric">Metric</label>
        <input id="goal-metric" value={metric} onChange={(e) => setMetric(e.target.value)} placeholder="Monthly revenue (LSL)" />
      </div>
      <div className="form-grid" style={{ marginBottom: "0.85rem" }}>
        <div className="field">
          <label htmlFor="goal-baseline">Starting value</label>
          <input id="goal-baseline" value={baselineValue} onChange={(e) => setBaselineValue(e.target.value)} inputMode="decimal" placeholder="48750" />
        </div>
        <div className="field">
          <label htmlFor="goal-target">Target value</label>
          <input id="goal-target" value={targetValue} onChange={(e) => setTargetValue(e.target.value)} inputMode="decimal" placeholder="70000" />
        </div>
      </div>
      <div className="form-grid">
        <div className="field">
          <label htmlFor="goal-deadline">Deadline</label>
          <input id="goal-deadline" type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="goal-priority">Priority</label>
          <select id="goal-priority" value={priority} onChange={(e) => setPriority(e.target.value as GoalPriority)}>
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>
        <Button variant="primary" disabled={submitting} onClick={() => void handleSubmit()}>
          {submitting ? "Creating…" : "Create goal"}
        </Button>
      </div>
    </Card>
  );
}

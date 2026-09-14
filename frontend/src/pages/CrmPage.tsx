import { useEffect, useState } from "react";
import { CrmApi } from "../api/resources";
import type { CrmActivity, CrmActivityType, Lead, LeadStage } from "../api/types";
import { ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { Banner, Button, Card, EmptyState, PageHeader, Pill, formatDateTime, formatMoney } from "../components/ui";

const STAGES: LeadStage[] = ["new", "qualified", "proposal", "negotiation", "won", "lost"];

const STAGE_LABEL: Record<LeadStage, string> = {
  new: "New",
  qualified: "Qualified",
  proposal: "Proposal",
  negotiation: "Negotiation",
  won: "Won",
  lost: "Lost",
};

const STAGE_TONE: Record<LeadStage, "positive" | "attention" | "critical" | "neutral" | "gold"> = {
  new: "neutral",
  qualified: "gold",
  proposal: "gold",
  negotiation: "attention",
  won: "positive",
  lost: "critical",
};

const ACTIVITY_TYPES: CrmActivityType[] = ["note", "call", "whatsapp", "meeting"];

/**
 * Phase 5 of the GrowthOS-aligned restructuring plan
 * (C:\Users\USER\.claude\plans\twinkly-sprouting-orbit.md) — the CRM/
 * pipeline module this plan's own analysis found was the single biggest
 * real gap in the platform. Kanban-style stage columns, horizontally
 * scrollable at narrow widths (same "wide content gets its own scroll
 * container, the page body never scrolls sideways" discipline as this
 * app's own data tables) rather than stacking six columns full-width on a
 * phone, which would make the pipeline shape itself illegible.
 */
export function CrmPage() {
  const { session } = useAuth();
  const tenantId = session.status === "loggedIn" ? session.profile.tenantId : "";
  const canManage = session.status === "loggedIn" && session.profile.role !== "read_only";

  const [leads, setLeads] = useState<Lead[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function load() {
    if (!tenantId) return;
    try {
      setLeads(await CrmApi.list(tenantId));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load leads.");
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  async function moveStage(leadId: string, stage: LeadStage) {
    setBusyId(leadId);
    setError(null);
    try {
      await CrmApi.moveStage(tenantId, leadId, stage);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not move this lead.");
    } finally {
      setBusyId(null);
    }
  }

  const selected = leads.find((l) => l.id === selectedId) ?? null;

  return (
    <div>
      <PageHeader
        title="CRM"
        subtitle="Leads and opportunities, from first contact through to a real customer."
        actions={
          canManage && (
            <Button variant="primary" onClick={() => setShowForm((s) => !s)}>
              {showForm ? "Cancel" : "New lead"}
            </Button>
          )
        }
      />

      {error && <Banner kind="error">{error}</Banner>}

      {showForm && (
        <>
          <NewLeadForm
            tenantId={tenantId}
            onCreated={() => {
              setShowForm(false);
              void load();
            }}
          />
          <div style={{ height: "1.1rem" }} />
        </>
      )}

      <div style={{ overflowX: "auto", paddingBottom: "0.4rem" }}>
        <div style={{ display: "flex", gap: "0.85rem", minWidth: "min-content" }}>
          {STAGES.map((stage) => {
            const stageLeads = leads.filter((l) => l.stage === stage);
            return (
              <div key={stage} style={{ width: 230, flexShrink: 0 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.5rem" }}>
                  <Pill tone={STAGE_TONE[stage]}>{STAGE_LABEL[stage]}</Pill>
                  <span style={{ fontSize: "0.78rem", color: "var(--color-ink-muted)" }}>{stageLeads.length}</span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                  {stageLeads.map((l) => (
                    <div
                      key={l.id}
                      className="card"
                      onClick={() => setSelectedId(l.id)}
                      style={{ cursor: "pointer", padding: "0.65rem 0.75rem", borderColor: l.id === selectedId ? "var(--color-teal)" : undefined }}
                    >
                      <strong style={{ fontSize: "0.88rem" }}>{l.name}</strong>
                      {l.estimatedValue !== undefined && (
                        <p style={{ margin: "0.2rem 0 0", fontSize: "0.8rem", color: "var(--color-ink-muted)" }}>{formatMoney(l.estimatedValue)}</p>
                      )}
                      <p style={{ margin: "0.2rem 0 0", fontSize: "0.72rem", color: "var(--color-ink-muted)" }}>Since {formatDateTime(l.lastActivityAt)}</p>
                    </div>
                  ))}
                  {stageLeads.length === 0 && <p style={{ fontSize: "0.78rem", color: "var(--color-ink-muted)", margin: 0 }}>—</p>}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div style={{ height: "1.1rem" }} />

      {selected ? (
        <LeadDetail lead={selected} tenantId={tenantId} canManage={canManage} busy={busyId === selected.id} onMoveStage={moveStage} onChanged={load} />
      ) : (
        <div className="card">
          <EmptyState>{leads.length === 0 ? "No leads yet — add one to start a real pipeline." : "Select a lead to see its detail and activity."}</EmptyState>
        </div>
      )}
    </div>
  );
}

function LeadDetail({
  lead,
  tenantId,
  canManage,
  busy,
  onMoveStage,
  onChanged,
}: {
  lead: Lead;
  tenantId: string;
  canManage: boolean;
  busy: boolean;
  onMoveStage: (leadId: string, stage: LeadStage) => void;
  onChanged: () => void;
}) {
  const [activities, setActivities] = useState<CrmActivity[]>([]);
  const [activityType, setActivityType] = useState<CrmActivityType>("note");
  const [activityBody, setActivityBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function loadActivities() {
    try {
      setActivities(await CrmApi.listActivities(tenantId, lead.id));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load activity.");
    }
  }

  useEffect(() => {
    void loadActivities();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lead.id]);

  async function submitActivity() {
    if (!activityBody.trim()) {
      setError("Say what happened.");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      await CrmApi.logActivity(tenantId, lead.id, activityType, activityBody.trim());
      setActivityBody("");
      await loadActivities();
      onChanged(); // refreshes the board's own lastActivityAt-derived ordering
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not log this activity.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card title={lead.name}>
      {error && <Banner kind="error">{error}</Banner>}
      <p style={{ margin: "0 0 0.3rem", fontSize: "0.85rem", color: "var(--color-ink-muted)" }}>
        {lead.source}
        {lead.contactPhone && ` · ${lead.contactPhone}`}
        {lead.contactEmail && ` · ${lead.contactEmail}`}
        {lead.estimatedValue !== undefined && ` · ${formatMoney(lead.estimatedValue)}`}
      </p>
      {lead.wonCustomerId && <p style={{ margin: "0 0 0.6rem", fontSize: "0.82rem" }}>Matched to a real customer record on winning this lead.</p>}

      {canManage && lead.stage !== "won" && lead.stage !== "lost" && (
        <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap", margin: "0.7rem 0" }}>
          {STAGES.filter((s) => s !== lead.stage && s !== "lost").map((s) => (
            <Button key={s} variant="secondary" disabled={busy} onClick={() => onMoveStage(lead.id, s)}>
              Move to {STAGE_LABEL[s]}
            </Button>
          ))}
          <Button variant="danger" disabled={busy} onClick={() => onMoveStage(lead.id, "lost")}>
            Mark lost
          </Button>
        </div>
      )}

      <div style={{ borderTop: "1px solid var(--color-border)", marginTop: "0.7rem", paddingTop: "0.7rem" }}>
        <strong style={{ fontSize: "0.85rem" }}>Activity</strong>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", margin: "0.5rem 0" }}>
          {activities.length === 0 && <p style={{ fontSize: "0.82rem", color: "var(--color-ink-muted)", margin: 0 }}>No activity logged yet.</p>}
          {activities.map((a) => (
            <div key={a.id} style={{ fontSize: "0.82rem" }}>
              <Pill tone="neutral">{a.type}</Pill> <span style={{ color: "var(--color-ink-muted)" }}>{formatDateTime(a.createdAt)}</span>
              <p style={{ margin: "0.15rem 0 0" }}>{a.body}</p>
            </div>
          ))}
        </div>

        {canManage && (
          <div className="form-grid" style={{ alignItems: "end" }}>
            <div className="field">
              <label htmlFor="activity-type">Type</label>
              <select id="activity-type" value={activityType} onChange={(e) => setActivityType(e.target.value as CrmActivityType)}>
                {ACTIVITY_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="activity-body">What happened</label>
              <input id="activity-body" value={activityBody} onChange={(e) => setActivityBody(e.target.value)} placeholder="Called, interested in the family package" />
            </div>
            <Button variant="primary" disabled={submitting} onClick={() => void submitActivity()}>
              {submitting ? "Logging…" : "Log activity"}
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}

function NewLeadForm({ tenantId, onCreated }: { tenantId: string; onCreated: () => void }) {
  const [name, setName] = useState("");
  const [source, setSource] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [estimatedValue, setEstimatedValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    if (!name.trim() || !source.trim()) {
      setError("Name and source are both required.");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      await CrmApi.create(tenantId, {
        name: name.trim(),
        source: source.trim(),
        contactPhone: contactPhone.trim() || undefined,
        contactEmail: contactEmail.trim() || undefined,
        estimatedValue: estimatedValue.trim() ? Number(estimatedValue) : undefined,
      });
      setName("");
      setSource("");
      setContactPhone("");
      setContactEmail("");
      setEstimatedValue("");
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create this lead.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card title="New lead">
      {error && <Banner kind="error">{error}</Banner>}
      <div className="form-grid" style={{ marginBottom: "0.85rem" }}>
        <div className="field">
          <label htmlFor="lead-name">Business / contact name</label>
          <input id="lead-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Thabo's Bakery" />
        </div>
        <div className="field">
          <label htmlFor="lead-source">Source</label>
          <input id="lead-source" value={source} onChange={(e) => setSource(e.target.value)} placeholder="Facebook ad" />
        </div>
      </div>
      <div className="form-grid">
        <div className="field">
          <label htmlFor="lead-phone">Phone</label>
          <input id="lead-phone" value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} placeholder="+26650000000" />
        </div>
        <div className="field">
          <label htmlFor="lead-email">Email</label>
          <input id="lead-email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="lead-value">Estimated value</label>
          <input id="lead-value" value={estimatedValue} onChange={(e) => setEstimatedValue(e.target.value)} inputMode="decimal" />
        </div>
        <Button variant="primary" disabled={submitting} onClick={() => void handleSubmit()}>
          {submitting ? "Creating…" : "Create lead"}
        </Button>
      </div>
    </Card>
  );
}

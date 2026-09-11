import { useEffect, useState } from "react";
import { SupportTicketsApi } from "../api/resources";
import type { SupportTicket, SupportTicketSeverity, SupportTicketStatus } from "../api/types";
import { ApiError } from "../api/client";
import { Banner, Button, Card, EmptyState, PageHeader, Pill, formatDateTime } from "../components/ui";

const SEVERITIES: SupportTicketSeverity[] = ["low", "normal", "high", "critical"];

const STATUS_TONE: Record<SupportTicketStatus, "positive" | "attention" | "critical" | "neutral" | "gold"> = {
  open: "attention",
  in_progress: "gold",
  resolved: "positive",
};

const SEVERITY_TONE: Record<SupportTicketSeverity, "positive" | "attention" | "critical" | "neutral" | "gold"> = {
  low: "neutral",
  normal: "gold",
  high: "attention",
  critical: "critical",
};

export function SupportTicketsPage() {
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      setTickets(await SupportTicketsApi.list());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load support tickets.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function reopen(id: string) {
    setBusyId(id);
    try {
      await SupportTicketsApi.reopen(id);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reopen this ticket.");
    } finally {
      setBusyId(null);
    }
  }

  const sorted = [...tickets].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  return (
    <div>
      <PageHeader
        title="Support"
        subtitle="Tell Mytrima about a problem with the platform itself."
        actions={
          <Button variant="primary" onClick={() => setShowForm((s) => !s)}>
            {showForm ? "Cancel" : "Log a ticket"}
          </Button>
        }
      />

      {error && <Banner kind="error">{error}</Banner>}

      {showForm && (
        <>
          <NewTicketForm
            onCreated={() => {
              setShowForm(false);
              void load();
            }}
          />
          <div style={{ height: "1.1rem" }} />
        </>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
        {sorted.map((t) => (
          <div className="card" key={t.id}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "0.75rem", flexWrap: "wrap" }}>
              <div>
                <strong>{t.subject}</strong>
                <p style={{ margin: "0.25rem 0 0", fontSize: "0.85rem", color: "var(--color-ink-muted)" }}>{t.description}</p>
              </div>
              <div style={{ display: "flex", gap: "0.4rem", flexShrink: 0 }}>
                <Pill tone={SEVERITY_TONE[t.severity]}>{t.severity}</Pill>
                <Pill tone={STATUS_TONE[t.status]}>{t.status.replace("_", " ")}</Pill>
              </div>
            </div>
            {t.resolutionNotes && (
              <div style={{ marginTop: "0.6rem", fontSize: "0.85rem", background: "var(--color-surface-sunken)", borderRadius: 7, padding: "0.55rem 0.7rem" }}>
                <strong>Mytrima's response:</strong> {t.resolutionNotes}
              </div>
            )}
            <div style={{ marginTop: "0.6rem", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: "0.78rem", color: "var(--color-ink-muted)" }}>Filed {formatDateTime(t.createdAt)}</span>
              {t.status === "resolved" && (
                <Button variant="ghost" disabled={busyId === t.id} onClick={() => void reopen(t.id)}>
                  This didn't fix it — reopen
                </Button>
              )}
            </div>
          </div>
        ))}
        {!loading && sorted.length === 0 && (
          <div className="card">
            <EmptyState>No support tickets filed yet.</EmptyState>
          </div>
        )}
      </div>
    </div>
  );
}

function NewTicketForm({ onCreated }: { onCreated: () => void }) {
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [severity, setSeverity] = useState<SupportTicketSeverity>("normal");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    if (!subject.trim() || !description.trim()) {
      setError("A subject and description are both required.");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      await SupportTicketsApi.create(subject.trim(), description.trim(), severity);
      setSubject("");
      setDescription("");
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not file this ticket.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card title="Log a ticket">
      {error && <Banner kind="error">{error}</Banner>}
      <div className="field" style={{ marginBottom: "0.85rem" }}>
        <label htmlFor="ticket-subject">Subject</label>
        <input id="ticket-subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
      </div>
      <div className="field" style={{ marginBottom: "0.85rem" }}>
        <label htmlFor="ticket-description">What went wrong?</label>
        <textarea id="ticket-description" value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>
      <div className="form-grid">
        <div className="field">
          <label htmlFor="ticket-severity">Severity</label>
          <select id="ticket-severity" value={severity} onChange={(e) => setSeverity(e.target.value as SupportTicketSeverity)}>
            {SEVERITIES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <Button variant="primary" disabled={submitting} onClick={() => void handleSubmit()}>
          {submitting ? "Filing…" : "File ticket"}
        </Button>
      </div>
    </Card>
  );
}

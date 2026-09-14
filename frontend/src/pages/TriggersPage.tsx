import { useEffect, useState } from "react";
import { TriggersApi } from "../api/resources";
import type { Trigger, TriggerSeverity, TriggerStatus } from "../api/types";
import { ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { Banner, EmptyState, PageHeader, Pill, Button, formatDateTime } from "../components/ui";

const SEVERITY_TONE: Record<TriggerSeverity, "positive" | "attention" | "critical" | "neutral" | "gold"> = {
  critical: "critical",
  warning: "attention",
  info: "neutral",
};

const SOURCE_MODULE_LABEL: Record<string, string> = {
  growth_audit: "Growth audit",
  nps: "Customer experience",
  reputation: "Customer experience",
  sales: "Sales",
  booking: "Bookings",
  crm: "CRM",
};

const FILTERS: { value: TriggerStatus | "all"; label: string }[] = [
  { value: "open", label: "Open" },
  { value: "actioned", label: "Actioned" },
  { value: "dismissed", label: "Dismissed" },
  { value: "all", label: "All" },
];

/**
 * Phase 2 of the GrowthOS-aligned restructuring plan
 * (C:\Users\USER\.claude\plans\twinkly-sprouting-orbit.md). Every row here
 * is a real, persisted Trigger produced by one of automation.service.ts's
 * own notificationsFor*() functions (see trigger.service.ts's own top
 * comment) — this page adds nothing of its own beyond listing and letting
 * a tenant dismiss or convert one, the same "no fabricated state" discipline
 * GrowthActionsPage.tsx already established for its own derived signals.
 * "Create action" here (Phase 4) really does create a real GrowthAction —
 * see TriggerService.convertToAction().
 */
export function TriggersPage() {
  const { session } = useAuth();
  const tenantId = session.status === "loggedIn" ? session.profile.tenantId : "";
  const canManage = session.status === "loggedIn" && session.profile.role !== "read_only";

  const [triggers, setTriggers] = useState<Trigger[]>([]);
  const [filter, setFilter] = useState<TriggerStatus | "all">("open");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function load(status: TriggerStatus | "all") {
    if (!tenantId) return;
    setLoading(true);
    try {
      setTriggers(await TriggersApi.list(tenantId, status === "all" ? undefined : status));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load triggers.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load(filter);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, filter]);

  async function dismiss(id: string) {
    setBusyId(id);
    try {
      await TriggersApi.dismiss(tenantId, id);
      await load(filter);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not dismiss this trigger.");
    } finally {
      setBusyId(null);
    }
  }

  async function convertToAction(id: string) {
    setBusyId(id);
    try {
      // Phase 2 stub — see TriggerService.convertToAction()'s own comment;
      // Phase 4 (Growth Actions) is what gives this a real destination.
      await TriggersApi.convertToAction(tenantId, id);
      await load(filter);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not convert this trigger to an action.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <PageHeader title="Triggers" subtitle="Real changes this platform has already detected in your business — reviewed here, not just sent once and forgotten." />

      {error && <Banner kind="error">{error}</Banner>}

      <div style={{ display: "flex", gap: "0.4rem", marginBottom: "0.9rem" }}>
        {FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            onClick={() => setFilter(f.value)}
            className={f.value === filter ? "shell-link active" : undefined}
            style={
              f.value === filter
                ? { background: "var(--color-teal)", color: "#fff", border: "none", borderRadius: 7, padding: "0.4rem 0.8rem", fontSize: "0.85rem", cursor: "pointer" }
                : {
                    background: "var(--color-surface-sunken)",
                    color: "var(--color-ink)",
                    border: "1px solid var(--color-border)",
                    borderRadius: 7,
                    padding: "0.4rem 0.8rem",
                    fontSize: "0.85rem",
                    cursor: "pointer",
                  }
            }
          >
            {f.label}
          </button>
        ))}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
        {triggers.map((t) => (
          <div className="card" key={t.id}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "0.75rem", flexWrap: "wrap" }}>
              <div>
                <p style={{ margin: 0 }}>{t.message}</p>
                <p style={{ margin: "0.3rem 0 0", fontSize: "0.78rem", color: "var(--color-ink-muted)" }}>
                  {SOURCE_MODULE_LABEL[t.sourceModule] ?? t.sourceModule} · {formatDateTime(t.createdAt)}
                </p>
              </div>
              <Pill tone={SEVERITY_TONE[t.severity]}>{t.severity}</Pill>
            </div>
            {canManage && t.status === "open" && (
              <div style={{ marginTop: "0.7rem", display: "flex", gap: "0.5rem" }}>
                <Button variant="secondary" disabled={busyId === t.id} onClick={() => void convertToAction(t.id)}>
                  Create action
                </Button>
                <Button variant="ghost" disabled={busyId === t.id} onClick={() => void dismiss(t.id)}>
                  Dismiss
                </Button>
              </div>
            )}
            {t.status !== "open" && (
              <div style={{ marginTop: "0.6rem" }}>
                <Pill tone={t.status === "actioned" ? "positive" : "neutral"}>{t.status}</Pill>
              </div>
            )}
          </div>
        ))}
        {!loading && triggers.length === 0 && (
          <div className="card">
            <EmptyState>{filter === "open" ? "No open triggers — nothing needs your attention right now." : "No triggers here."}</EmptyState>
          </div>
        )}
      </div>
    </div>
  );
}

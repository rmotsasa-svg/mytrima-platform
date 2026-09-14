import { useEffect, useState } from "react";
import { GrowthActionsApi, RetentionApi } from "../api/resources";
import type { RetentionCustomer, RetentionSummary } from "../api/types";
import { ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { Banner, Button, Card, EmptyState, PageHeader, Pill, formatDateTime, formatPct } from "../components/ui";

/**
 * Phase 6 of the GrowthOS-aligned restructuring plan
 * (C:\Users\USER\.claude\plans\twinkly-sprouting-orbit.md). Deliberately
 * read-only — every number here is RetentionService's own real,
 * server-computed summary; this page adds no client-side recomputation.
 * The one write action ("Contact N inactive customers") creates a single
 * real GrowthAction (Phase 4) rather than inventing a third task concept —
 * matches the source GrowthOS proposal's own example almost exactly
 * ("Retention Action: Contact 23 inactive customers," later given a real
 * `result` once the outreach is actually done, editable from the Growth
 * Actions page).
 */
export function RetentionPage() {
  const { session } = useAuth();
  const tenantId = session.status === "loggedIn" ? session.profile.tenantId : "";
  const canManage = session.status === "loggedIn" && session.profile.role !== "read_only";

  const [summary, setSummary] = useState<RetentionSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionCreated, setActionCreated] = useState(false);
  const [creatingAction, setCreatingAction] = useState(false);

  async function load() {
    if (!tenantId) return;
    setLoading(true);
    try {
      setSummary(await RetentionApi.summary(tenantId));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load retention data.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  async function createContactAction() {
    if (!summary || summary.inactive.length === 0) return;
    setCreatingAction(true);
    setError(null);
    try {
      await GrowthActionsApi.create(tenantId, {
        title: `Contact ${summary.inactive.length} inactive customer${summary.inactive.length === 1 ? "" : "s"}`,
        reason: `No purchase in ${summary.inactiveThresholdDays}+ days — real customers at real risk of being lost for good.`,
        priority: summary.reactivationCandidates.length > 0 ? "high" : "medium",
        expectedImpact: "Retention",
      });
      setActionCreated(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create this action.");
    } finally {
      setCreatingAction(false);
    }
  }

  return (
    <div>
      <PageHeader title="Retention" subtitle="Who's about to leave, who's already gone quiet, and who's worth winning back." />
      {error && <Banner kind="error">{error}</Banner>}

      {summary && (
        <>
          <div className="stat-grid" style={{ marginBottom: "1.1rem" }}>
            <div className="stat-tile">
              <span>Repeat rate</span>
              <strong>{summary.repeatRate.repeatRate !== null ? formatPct(summary.repeatRate.repeatRate) : "No new customers yet"}</strong>
              <span style={{ fontSize: "0.75rem", color: "var(--color-ink-muted)" }}>
                {summary.repeatRate.repeatCustomerCount} of {summary.repeatRate.newCustomerCount} new customers came back
              </span>
            </div>
            <div className="stat-tile">
              <span>At risk</span>
              <strong>{summary.atRisk.length}</strong>
              <span style={{ fontSize: "0.75rem", color: "var(--color-ink-muted)" }}>{summary.atRiskThresholdDays}+ days quiet</span>
            </div>
            <div className="stat-tile">
              <span>Inactive</span>
              <strong>{summary.inactive.length}</strong>
              <span style={{ fontSize: "0.75rem", color: "var(--color-ink-muted)" }}>{summary.inactiveThresholdDays}+ days quiet</span>
            </div>
            <div className="stat-tile">
              <span>Worth winning back</span>
              <strong>{summary.reactivationCandidates.length}</strong>
              <span style={{ fontSize: "0.75rem", color: "var(--color-ink-muted)" }}>inactive, but were repeat customers</span>
            </div>
          </div>

          <Card
            title="Customers at risk"
            actions={
              canManage &&
              summary.inactive.length > 0 && (
                <Button variant="secondary" disabled={creatingAction || actionCreated} onClick={() => void createContactAction()}>
                  {actionCreated ? "Action created" : creatingAction ? "Creating…" : `Contact ${summary.inactive.length} inactive customers`}
                </Button>
              )
            }
          >
            <CustomerList customers={summary.atRisk} tone="attention" emptyText="No customers currently at risk." />
          </Card>

          <div style={{ height: "1.1rem" }} />

          <Card title="Inactive customers">
            <CustomerList customers={summary.inactive} tone="critical" emptyText="No inactive customers — everyone's still coming back." />
          </Card>

          <div style={{ height: "1.1rem" }} />

          <Card title="Worth winning back">
            <CustomerList
              customers={summary.reactivationCandidates}
              tone="gold"
              emptyText="No repeat customers have gone quiet yet."
              subtitle="totalPurchases"
            />
          </Card>
        </>
      )}

      {!loading && !summary && !error && (
        <div className="card">
          <EmptyState>No retention data yet.</EmptyState>
        </div>
      )}
    </div>
  );
}

function CustomerList({
  customers,
  tone,
  emptyText,
  subtitle,
}: {
  customers: RetentionCustomer[];
  tone: "positive" | "attention" | "critical" | "neutral" | "gold";
  emptyText: string;
  subtitle?: "totalPurchases";
}) {
  if (customers.length === 0) return <EmptyState>{emptyText}</EmptyState>;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.55rem" }}>
      {customers.map((c) => (
        <div key={c.customerId} style={{ display: "flex", gap: "0.75rem", alignItems: "center", flexWrap: "wrap", fontSize: "0.88rem" }}>
          <Pill tone={tone}>{c.daysSinceLastPurchase} days</Pill>
          <strong>{c.displayName ?? c.phone ?? c.email ?? c.customerId}</strong>
          {subtitle === "totalPurchases" && (
            <span style={{ color: "var(--color-ink-muted)" }}>
              {c.totalPurchases} past purchase{c.totalPurchases === 1 ? "" : "s"}
            </span>
          )}
          <span style={{ color: "var(--color-ink-muted)" }}>last bought {formatDateTime(c.lastPurchaseAt)}</span>
        </div>
      ))}
    </div>
  );
}

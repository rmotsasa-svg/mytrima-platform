import { Fragment, useEffect, useState } from "react";
import { AdminTenantApi } from "../api/resources";
import type { AdminTenantDetail, AdminTenantSummary } from "../api/types";
import { ApiError } from "../api/client";
import { Banner, Button, Card, EmptyState, PageHeader, Pill, formatDateTime, formatMoney } from "../components/ui";

const TIER_LABEL: Record<AdminTenantSummary["subscriptionTier"], string> = {
  free: "Free",
  pro_plus: "Pro Plus",
  growth_plan: "Growth Plan",
  growth_partner: "Growth Partner",
};

function statusTone(status: AdminTenantSummary["status"]): "positive" | "attention" | "critical" {
  if (status === "suspended") return "critical";
  if (status === "pilot") return "attention";
  return "positive";
}

function subscriptionTone(status: AdminTenantSummary["subscriptionStatus"]): "positive" | "attention" | "critical" {
  if (status === "past_due") return "critical";
  if (status === "pending_payment") return "attention";
  return "positive";
}

/** Phase 2 of the admin-platform plan — real, cross-tenant tenant
 * management. Directly mirrors frontend/src/pages/StaffPage.tsx's own
 * proven pattern: a data table, each row's "Detail" action expanding an
 * inline <tr><td colSpan> panel rather than a separate route/modal. */
export function TenantsPage() {
  const [tenants, setTenants] = useState<AdminTenantSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      setTenants(await AdminTenantApi.list());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load tenants.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function toggleSuspension(tenant: AdminTenantSummary) {
    setBusyId(tenant.tenantId);
    setError(null);
    try {
      if (tenant.status === "suspended") {
        await AdminTenantApi.reactivate(tenant.tenantId);
      } else {
        await AdminTenantApi.suspend(tenant.tenantId);
      }
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not update this tenant's status.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <PageHeader title="Tenants" subtitle={`${tenants.length} tenant${tenants.length === 1 ? "" : "s"} on the platform`} />

      {error && <Banner kind="error">{error}</Banner>}

      <div style={{ height: "1.1rem" }} />

      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th>Tenant</th>
              <th>Status</th>
              <th>Subscription</th>
              <th>Staff</th>
              <th>Open tickets</th>
              <th>Growth audit</th>
              <th>NPS</th>
              <th>Onboarding</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {tenants.map((tenant) => (
              <Fragment key={tenant.tenantId}>
                <tr>
                  <td>{tenant.tenantName}</td>
                  <td>
                    <Pill tone={statusTone(tenant.status)}>{tenant.status}</Pill>
                  </td>
                  <td>
                    <Pill tone={subscriptionTone(tenant.subscriptionStatus)}>
                      {TIER_LABEL[tenant.subscriptionTier]} — {tenant.subscriptionStatus.replace("_", " ")}
                    </Pill>
                  </td>
                  <td className="tabular">{tenant.staffCount}</td>
                  <td className="tabular">{tenant.openSupportTicketCount}</td>
                  <td className="tabular">
                    {tenant.latestGrowthAuditScore === null ? "—" : `${tenant.latestGrowthAuditScore} (${tenant.latestGrowthAuditBand})`}
                  </td>
                  <td className="tabular">{tenant.npsScore === null ? "—" : `${tenant.npsScore} (${tenant.npsResponseCount})`}</td>
                  <td className="tabular">{tenant.onboardingPercentComplete}%</td>
                  <td>
                    <div style={{ display: "flex", gap: "0.35rem", flexWrap: "wrap" }}>
                      <Button variant="ghost" onClick={() => setDetailId((id) => (id === tenant.tenantId ? null : tenant.tenantId))}>
                        {detailId === tenant.tenantId ? "Hide detail" : "Detail"}
                      </Button>
                      <Button
                        variant={tenant.status === "suspended" ? "secondary" : "danger"}
                        disabled={busyId === tenant.tenantId}
                        onClick={() => void toggleSuspension(tenant)}
                      >
                        {tenant.status === "suspended" ? "Reactivate" : "Suspend"}
                      </Button>
                    </div>
                  </td>
                </tr>
                {detailId === tenant.tenantId && (
                  <tr>
                    <td colSpan={9} style={{ background: "var(--color-surface-sunken)" }}>
                      <TenantDetailPanel tenantId={tenant.tenantId} />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
        {!loading && tenants.length === 0 && (
          <EmptyState>
            No tenants to show. This view is only populated against a real Postgres instance — see PilotSummaryService's own disclosed
            limitation.
          </EmptyState>
        )}
      </div>
    </div>
  );
}

function TenantDetailPanel({ tenantId }: { tenantId: string }) {
  const [detail, setDetail] = useState<AdminTenantDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    AdminTenantApi.detail(tenantId)
      .then((d) => !cancelled && setDetail(d))
      .catch((err) => !cancelled && setError(err instanceof ApiError ? err.message : "Could not load this tenant's detail."));
    return () => {
      cancelled = true;
    };
  }, [tenantId]);

  if (error) return <Banner kind="error">{error}</Banner>;
  if (!detail) return <p style={{ margin: "0.5rem 0", fontSize: "0.85rem", color: "var(--color-ink-muted)" }}>Loading…</p>;

  return (
    <div style={{ padding: "0.75rem 0", display: "flex", flexDirection: "column", gap: "1rem" }}>
      <Card title="Staff">
        {detail.staff.length === 0 ? (
          <EmptyState>No staff accounts yet.</EmptyState>
        ) : (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Staff ID</th>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th>Member since</th>
                </tr>
              </thead>
              <tbody>
                {detail.staff.map((member) => (
                  <tr key={member.id}>
                    <td className="tabular">{member.staffIdNumber}</td>
                    <td>{[member.firstName, member.lastName].filter(Boolean).join(" ") || "—"}</td>
                    <td>{member.email}</td>
                    <td>{member.role.replace("_", " ")}</td>
                    <td>
                      <Pill tone={member.isActive ? "positive" : "critical"}>{member.isActive ? "Active" : "Deactivated"}</Pill>
                    </td>
                    <td>{formatDateTime(member.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="Subscription payment history">
        {detail.subscriptionPayments.length === 0 ? (
          <EmptyState>No payments recorded yet.</EmptyState>
        ) : (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Tier</th>
                  <th>Amount</th>
                  <th>Status</th>
                  <th>Created</th>
                  <th>Paid</th>
                </tr>
              </thead>
              <tbody>
                {detail.subscriptionPayments.map((payment) => (
                  <tr key={payment.id}>
                    <td>{TIER_LABEL[payment.tier]}</td>
                    <td className="tabular">{formatMoney(payment.amountZar)}</td>
                    <td>
                      <Pill tone={payment.status === "paid" ? "positive" : payment.status === "failed" ? "critical" : "attention"}>
                        {payment.status}
                      </Pill>
                    </td>
                    <td>{formatDateTime(payment.createdAt)}</td>
                    <td>{formatDateTime(payment.paidAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

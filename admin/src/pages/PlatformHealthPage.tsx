import { useEffect, useState } from "react";
import { AdminPlatformHealthApi } from "../api/resources";
import type { PlatformHealth } from "../api/types";
import { ApiError } from "../api/client";
import { Banner, Card, EmptyState, PageHeader, Pill, formatMoney } from "../components/ui";

/** Phase 3 of the admin-platform plan — real platform performance, built
 * entirely from infra that already exists (see PlatformHealthService's
 * own top comment for what's real vs. explicitly out of scope). */
export function PlatformHealthPage() {
  const [health, setHealth] = useState<PlatformHealth | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      setHealth(await AdminPlatformHealthApi.get());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load platform health.");
    }
  }

  useEffect(() => {
    void load();
  }, []);

  if (error) return <Banner kind="error">{error}</Banner>;
  if (!health) return <p style={{ color: "var(--color-ink-muted)" }}>Loading…</p>;

  return (
    <div>
      <PageHeader title="Platform performance" subtitle="Real, currently-computable signals — no invented telemetry." />

      <div className="stat-grid">
        <div className="card stat-tile">
          <p className="card-title">MRR</p>
          <p className="stat-value">{formatMoney(health.business.mrrZar)}</p>
          <p className="stat-delta" data-dir="flat">
            {health.business.tenantCount} tenant{health.business.tenantCount === 1 ? "" : "s"}
          </p>
        </div>
        <div className="card stat-tile">
          <p className="card-title">Past due (at-risk revenue)</p>
          <p className="stat-value">{health.business.pastDueTenantCount}</p>
        </div>
        <div className="card stat-tile">
          <p className="card-title">Open support tickets</p>
          <p className="stat-value">{health.supportTickets.openCount}</p>
          <p className="stat-delta" data-dir="flat">
            {health.supportTickets.inProgressCount} in progress
          </p>
        </div>
        <div className="card stat-tile">
          <p className="card-title">Avg. resolution time</p>
          <p className="stat-value">
            {health.supportTickets.averageResolutionHours === null ? "—" : `${health.supportTickets.averageResolutionHours.toFixed(1)}h`}
          </p>
          <p className="stat-delta" data-dir="flat">
            {health.supportTickets.resolvedCount} resolved
          </p>
        </div>
      </div>

      <div style={{ height: "1.1rem" }} />

      <Card title="Tenants by tier">
        {Object.keys(health.business.tenantsByTier).length === 0 ? (
          <EmptyState>No tenants yet.</EmptyState>
        ) : (
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            {Object.entries(health.business.tenantsByTier).map(([tier, count]) => (
              <Pill key={tier} tone="neutral">
                {tier.replace("_", " ")}: {count}
              </Pill>
            ))}
          </div>
        )}
      </Card>

      <div style={{ height: "1.1rem" }} />

      <Card title="Signups, last 30 days">
        {health.business.signupsByDay.length === 0 ? (
          <EmptyState>No signups in the last 30 days.</EmptyState>
        ) : (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Signups</th>
                </tr>
              </thead>
              <tbody>
                {health.business.signupsByDay.map((d) => (
                  <tr key={d.date}>
                    <td>{d.date}</td>
                    <td className="tabular">{d.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div style={{ height: "1.1rem" }} />

      <Card title="Database">
        {health.database.configured ? (
          <div className="stat-grid">
            <div className="card stat-tile">
              <p className="card-title">Total connections</p>
              <p className="stat-value">{health.database.totalCount}</p>
            </div>
            <div className="card stat-tile">
              <p className="card-title">Idle</p>
              <p className="stat-value">{health.database.idleCount}</p>
            </div>
            <div className="card stat-tile">
              <p className="card-title">Waiting</p>
              <p className="stat-value">{health.database.waitingCount}</p>
            </div>
          </div>
        ) : (
          <Banner kind="info">DATABASE_URL is not configured in this environment.</Banner>
        )}
      </Card>

      <div style={{ height: "1.1rem" }} />

      <Card title="Queues">
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Queue</th>
                <th>Status</th>
                <th>Waiting</th>
                <th>Active</th>
                <th>Completed</th>
                <th>Failed</th>
                <th>Delayed</th>
              </tr>
            </thead>
            <tbody>
              {health.queues.map((q) => (
                <tr key={q.name}>
                  <td>{q.name}</td>
                  <td>
                    <Pill tone={q.configured ? "positive" : "neutral"}>{q.configured ? "Configured" : "Not configured"}</Pill>
                  </td>
                  <td className="tabular">{q.waiting ?? "—"}</td>
                  <td className="tabular">{q.active ?? "—"}</td>
                  <td className="tabular">{q.completed ?? "—"}</td>
                  <td className="tabular">{q.failed ?? "—"}</td>
                  <td className="tabular">{q.delayed ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

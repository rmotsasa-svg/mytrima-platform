import { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { WebsiteVisit, WebsiteVisitStore, DeviceType } from "./website-visit.service";
import { runWithTenantContext } from "../../common/postgres";

interface WebsiteVisitRow {
  id: string;
  tenant_id: string;
  session_id: string;
  path: string;
  referrer: string | null;
  country: string | null;
  device_type: DeviceType;
  occurred_at: Date;
}

function rowToVisit(row: WebsiteVisitRow): WebsiteVisit {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    sessionId: row.session_id,
    path: row.path,
    referrer: row.referrer ?? undefined,
    country: row.country ?? undefined,
    deviceType: row.device_type,
    occurredAt: row.occurred_at,
  };
}

/** Real Postgres-backed WebsiteVisitStore, against `website_visit`
 * (db/migrations/0025_website_analytics.sql). Same runWithTenantContext
 * pattern as PgBookingStore's own save() — the caller here is an
 * unauthenticated site visitor's browser, not a verified Mytrima actor, so
 * the tenantId comes from the beacon payload itself (AnalyticsController),
 * exactly the way a public booking request already does. */
export class PgWebsiteVisitStore implements WebsiteVisitStore {
  constructor(private readonly pool: Pool) {}

  async save(visit: WebsiteVisit): Promise<void> {
    await runWithTenantContext(this.pool, visit.tenantId, (client) =>
      client.query(
        `insert into website_visit (id, tenant_id, session_id, path, referrer, country, device_type, occurred_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          visit.id || randomUUID(),
          visit.tenantId,
          visit.sessionId,
          visit.path,
          visit.referrer ?? null,
          visit.country ?? null,
          visit.deviceType,
          visit.occurredAt,
        ]
      )
    );
  }

  async findAllForTenant(tenantId: string, periodStart: Date, periodEnd: Date): Promise<WebsiteVisit[]> {
    return runWithTenantContext(this.pool, tenantId, async (client) => {
      const result = await client.query<WebsiteVisitRow>(
        `select * from website_visit
         where tenant_id = $1 and occurred_at >= $2 and occurred_at <= $3
         order by occurred_at asc`,
        [tenantId, periodStart, periodEnd]
      );
      return result.rows.map(rowToVisit);
    });
  }
}

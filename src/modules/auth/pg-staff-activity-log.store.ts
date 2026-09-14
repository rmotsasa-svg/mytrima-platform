import { Pool } from "pg";
import { StaffActivityLogEntry, StaffActivityLogStore, StaffActivityAction } from "./staff-activity.service";
import { runWithTenantContext } from "../../common/postgres";

interface StaffActivityLogRow {
  id: string;
  tenant_id: string;
  user_id: string;
  action: StaffActivityAction;
  details: Record<string, unknown> | null;
  occurred_at: Date;
}

function rowToEntry(row: StaffActivityLogRow): StaffActivityLogEntry {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    userId: row.user_id,
    action: row.action,
    details: row.details ?? undefined,
    occurredAt: row.occurred_at,
  };
}

/** Real Postgres-backed StaffActivityLogStore, against `staff_activity_log`
 * (db/migrations/0030_staff_manager_names_and_activity_log.sql). Append-only
 * — no update()/delete(), matching an audit log's own real semantics. */
export class PgStaffActivityLogStore implements StaffActivityLogStore {
  constructor(private readonly pool: Pool) {}

  async save(entry: StaffActivityLogEntry): Promise<void> {
    await runWithTenantContext(this.pool, entry.tenantId, (client) =>
      client.query(`insert into staff_activity_log (id, tenant_id, user_id, action, details) values ($1, $2, $3, $4, $5)`, [
        entry.id,
        entry.tenantId,
        entry.userId,
        entry.action,
        entry.details ? JSON.stringify(entry.details) : null,
      ])
    );
  }

  async findForTenant(tenantId: string, userId?: string): Promise<StaffActivityLogEntry[]> {
    const result = await runWithTenantContext(this.pool, tenantId, (client) =>
      userId
        ? client.query<StaffActivityLogRow>(
            `select * from staff_activity_log where tenant_id = $1 and user_id = $2 order by occurred_at desc`,
            [tenantId, userId]
          )
        : client.query<StaffActivityLogRow>(`select * from staff_activity_log where tenant_id = $1 order by occurred_at desc`, [tenantId])
    );
    return result.rows.map(rowToEntry);
  }
}

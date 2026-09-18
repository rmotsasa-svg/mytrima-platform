import { Pool } from "pg";
import { AuditLogEntry, AuditLogStore } from "./audit-log.service";
import { runWithTenantContext } from "../../common/postgres";

interface AuditLogRow {
  id: string;
  tenant_id: string | null;
  actor_user_id: string | null;
  action: string;
  entity_table: string;
  entity_id: string | null;
  occurred_at: Date;
  metadata: Record<string, unknown> | null;
}

function rowToEntry(row: AuditLogRow): AuditLogEntry {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    actorUserId: row.actor_user_id,
    action: row.action,
    entityTable: row.entity_table,
    entityId: row.entity_id,
    occurredAt: row.occurred_at,
    metadata: row.metadata,
  };
}

/** Real Postgres-backed AuditLogStore, against `audit_log`
 * (db/migrations/0001, RLS added 0023) — see audit-log.service.ts's own
 * top comment for the real RLS constraint this store works with: a
 * tenant-scoped row (tenant_id set) can only be written/read through a
 * connection whose `app.current_tenant_id` matches it exactly, same as
 * tenant_subscription_payment's own store, hence runWithTenantContext
 * for those two methods. Platform-level rows (tenant_id null) need no
 * such context — a plain query already sees exactly the null rows,
 * nothing else, per that migration's own USING clause. */
export class PgAuditLogStore implements AuditLogStore {
  constructor(private readonly pool: Pool) {}

  async record(entry: Omit<AuditLogEntry, "id" | "occurredAt">): Promise<void> {
    const metadata = entry.metadata ? JSON.stringify(entry.metadata) : null;
    if (entry.tenantId === null) {
      await this.pool.query(
        `insert into audit_log (tenant_id, actor_user_id, action, entity_table, entity_id, metadata) values (null, $1, $2, $3, $4, $5)`,
        [entry.actorUserId, entry.action, entry.entityTable, entry.entityId, metadata]
      );
      return;
    }
    await runWithTenantContext(this.pool, entry.tenantId, (client) =>
      client.query(
        `insert into audit_log (tenant_id, actor_user_id, action, entity_table, entity_id, metadata) values ($1, $2, $3, $4, $5, $6)`,
        [entry.tenantId, entry.actorUserId, entry.action, entry.entityTable, entry.entityId, metadata]
      )
    );
  }

  // Ordered by id (bigserial — real, strictly-increasing insertion
  // order), not occurred_at alone: two records in quick succession can
  // genuinely share the same timestamp, and id is the one column that's
  // never ambiguous about which came first.
  async listForTenant(tenantId: string): Promise<AuditLogEntry[]> {
    const result = await runWithTenantContext(this.pool, tenantId, (client) =>
      client.query<AuditLogRow>(
        `select id, tenant_id, actor_user_id, action, entity_table, entity_id, occurred_at, metadata
         from audit_log where tenant_id = $1 order by id desc limit 200`,
        [tenantId]
      )
    );
    return result.rows.map(rowToEntry);
  }

  async listPlatformLevel(): Promise<AuditLogEntry[]> {
    const result = await this.pool.query<AuditLogRow>(
      `select id, tenant_id, actor_user_id, action, entity_table, entity_id, occurred_at, metadata
       from audit_log where tenant_id is null order by id desc limit 200`
    );
    return result.rows.map(rowToEntry);
  }
}

import { Pool } from "pg";
import { Trigger, TriggerStatus, TriggerStore } from "./trigger.service";
import { NotificationType } from "../automation/automation.service";
import { runWithTenantContext } from "../../common/postgres";

interface TriggerRow {
  id: string;
  tenant_id: string;
  type: string;
  severity: string;
  message: string;
  about_customer_id: string | null;
  source_module: string;
  created_at: Date;
  status: string;
  actioned_at: Date | null;
}

function rowToTrigger(row: TriggerRow): Trigger {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    type: row.type as NotificationType,
    severity: row.severity as Trigger["severity"],
    message: row.message,
    aboutCustomerId: row.about_customer_id ?? undefined,
    sourceModule: row.source_module,
    createdAt: row.created_at,
    status: row.status as TriggerStatus,
    actionedAt: row.actioned_at ?? undefined,
  };
}

/** Real Postgres-backed TriggerStore, against `trigger`
 * (db/migrations/0034_triggers.sql). `trigger` is a reserved SQL keyword in
 * some contexts but not a reserved table-name in Postgres — kept singular
 * to match every other table in this schema (deal, campaign, booking). */
export class PgTriggerStore implements TriggerStore {
  constructor(private readonly pool: Pool) {}

  async save(trigger: Trigger): Promise<void> {
    await runWithTenantContext(this.pool, trigger.tenantId, (client) =>
      client.query(
        `insert into trigger (id, tenant_id, type, severity, message, about_customer_id, source_module, created_at, status, actioned_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         on conflict (id) do update set
           status      = excluded.status,
           actioned_at = excluded.actioned_at`,
        [
          trigger.id,
          trigger.tenantId,
          trigger.type,
          trigger.severity,
          trigger.message,
          trigger.aboutCustomerId ?? null,
          trigger.sourceModule,
          trigger.createdAt,
          trigger.status,
          trigger.actionedAt ?? null,
        ]
      )
    );
  }

  async findAllForTenant(tenantId: string, status?: TriggerStatus): Promise<Trigger[]> {
    const result = await runWithTenantContext(this.pool, tenantId, (client) =>
      status
        ? client.query<TriggerRow>(`select * from trigger where tenant_id = $1 and status = $2 order by created_at desc`, [tenantId, status])
        : client.query<TriggerRow>(`select * from trigger where tenant_id = $1 order by created_at desc`, [tenantId])
    );
    return result.rows.map(rowToTrigger);
  }

  async findById(tenantId: string, id: string): Promise<Trigger | null> {
    const result = await runWithTenantContext(this.pool, tenantId, (client) =>
      client.query<TriggerRow>(`select * from trigger where tenant_id = $1 and id = $2`, [tenantId, id])
    );
    return result.rows[0] ? rowToTrigger(result.rows[0]) : null;
  }
}

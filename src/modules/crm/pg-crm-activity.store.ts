import { Pool } from "pg";
import { CrmActivity, CrmActivityType, CrmActivityStore } from "./crm.service";
import { runWithTenantContext } from "../../common/postgres";

interface CrmActivityRow {
  id: string;
  tenant_id: string;
  lead_id: string;
  type: string;
  body: string;
  created_at: Date;
  created_by_user_id: string;
}

function rowToActivity(row: CrmActivityRow): CrmActivity {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    leadId: row.lead_id,
    type: row.type as CrmActivityType,
    body: row.body,
    createdAt: row.created_at,
    createdByUserId: row.created_by_user_id,
  };
}

/** Real Postgres-backed CrmActivityStore, against `crm_activity`
 * (db/migrations/0037_crm.sql) — insert-only, matching the store
 * interface's own comment (crm.service.ts) on why this is never a
 * delete-and-reinsert child collection. */
export class PgCrmActivityStore implements CrmActivityStore {
  constructor(private readonly pool: Pool) {}

  async save(activity: CrmActivity): Promise<void> {
    await runWithTenantContext(this.pool, activity.tenantId, (client) =>
      client.query(
        `insert into crm_activity (id, tenant_id, lead_id, type, body, created_at, created_by_user_id)
         values ($1, $2, $3, $4, $5, $6, $7)`,
        [activity.id, activity.tenantId, activity.leadId, activity.type, activity.body, activity.createdAt, activity.createdByUserId]
      )
    );
  }

  async findAllForLead(tenantId: string, leadId: string): Promise<CrmActivity[]> {
    const result = await runWithTenantContext(this.pool, tenantId, (client) =>
      client.query<CrmActivityRow>(`select * from crm_activity where tenant_id = $1 and lead_id = $2 order by created_at desc`, [tenantId, leadId])
    );
    return result.rows.map(rowToActivity);
  }
}

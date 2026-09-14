import { Pool } from "pg";
import { GrowthAction, GrowthActionPriority, GrowthActionStatus, GrowthActionStore } from "./growth-action.service";
import { runWithTenantContext } from "../../common/postgres";

interface GrowthActionRow {
  id: string;
  tenant_id: string;
  title: string;
  reason: string;
  priority: string;
  expected_impact: string;
  estimated_minutes: number | null;
  due_date: Date | null;
  owner_user_id: string | null;
  related_goal_id: string | null;
  related_trigger_id: string | null;
  status: string;
  result: string | null;
  created_at: Date;
}

function rowToAction(row: GrowthActionRow): GrowthAction {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    title: row.title,
    reason: row.reason,
    priority: row.priority as GrowthActionPriority,
    expectedImpact: row.expected_impact,
    estimatedMinutes: row.estimated_minutes ?? undefined,
    dueDate: row.due_date ?? undefined,
    ownerUserId: row.owner_user_id ?? undefined,
    relatedGoalId: row.related_goal_id ?? undefined,
    relatedTriggerId: row.related_trigger_id ?? undefined,
    status: row.status as GrowthActionStatus,
    result: row.result ?? undefined,
    createdAt: row.created_at,
  };
}

/** Real Postgres-backed GrowthActionStore, against `growth_action`
 * (db/migrations/0036_growth_actions.sql). */
export class PgGrowthActionStore implements GrowthActionStore {
  constructor(private readonly pool: Pool) {}

  async save(action: GrowthAction): Promise<void> {
    await runWithTenantContext(this.pool, action.tenantId, (client) =>
      client.query(
        `insert into growth_action
           (id, tenant_id, title, reason, priority, expected_impact, estimated_minutes, due_date, owner_user_id, related_goal_id, related_trigger_id, status, result, created_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
         on conflict (id) do update set
           title              = excluded.title,
           reason             = excluded.reason,
           priority           = excluded.priority,
           expected_impact    = excluded.expected_impact,
           estimated_minutes  = excluded.estimated_minutes,
           due_date           = excluded.due_date,
           owner_user_id      = excluded.owner_user_id,
           status             = excluded.status,
           result             = excluded.result`,
        [
          action.id,
          action.tenantId,
          action.title,
          action.reason,
          action.priority,
          action.expectedImpact,
          action.estimatedMinutes ?? null,
          action.dueDate ?? null,
          action.ownerUserId ?? null,
          action.relatedGoalId ?? null,
          action.relatedTriggerId ?? null,
          action.status,
          action.result ?? null,
          action.createdAt,
        ]
      )
    );
  }

  async findAllForTenant(tenantId: string, status?: GrowthActionStatus): Promise<GrowthAction[]> {
    const result = await runWithTenantContext(this.pool, tenantId, (client) =>
      status
        ? client.query<GrowthActionRow>(`select * from growth_action where tenant_id = $1 and status = $2 order by created_at desc`, [tenantId, status])
        : client.query<GrowthActionRow>(`select * from growth_action where tenant_id = $1 order by created_at desc`, [tenantId])
    );
    return result.rows.map(rowToAction);
  }

  async findById(tenantId: string, id: string): Promise<GrowthAction | null> {
    const result = await runWithTenantContext(this.pool, tenantId, (client) =>
      client.query<GrowthActionRow>(`select * from growth_action where tenant_id = $1 and id = $2`, [tenantId, id])
    );
    return result.rows[0] ? rowToAction(result.rows[0]) : null;
  }
}

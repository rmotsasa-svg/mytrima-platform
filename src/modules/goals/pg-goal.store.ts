import { Pool } from "pg";
import { Goal, GoalMetricType, GoalPriority, GoalStatus, GoalStore } from "./goal.service";
import { runWithTenantContext } from "../../common/postgres";

interface GoalRow {
  id: string;
  tenant_id: string;
  objective: string;
  metric: string;
  metric_type: string | null;
  baseline_value: string;
  current_value: string;
  target_value: string;
  deadline: Date;
  owner_user_id: string | null;
  priority: string;
  status: string;
  created_at: Date;
}

function rowToGoal(row: GoalRow): Goal {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    objective: row.objective,
    metric: row.metric,
    metricType: (row.metric_type as GoalMetricType | null) ?? undefined,
    baselineValue: Number(row.baseline_value),
    currentValue: Number(row.current_value),
    targetValue: Number(row.target_value),
    deadline: row.deadline,
    ownerUserId: row.owner_user_id ?? undefined,
    priority: row.priority as GoalPriority,
    status: row.status as GoalStatus,
    createdAt: row.created_at,
  };
}

/** Real Postgres-backed GoalStore, against `goal`
 * (db/migrations/0035_goals.sql). */
export class PgGoalStore implements GoalStore {
  constructor(private readonly pool: Pool) {}

  async save(goal: Goal): Promise<void> {
    await runWithTenantContext(this.pool, goal.tenantId, (client) =>
      client.query(
        `insert into goal (id, tenant_id, objective, metric, metric_type, baseline_value, current_value, target_value, deadline, owner_user_id, priority, status, created_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
         on conflict (id) do update set
           objective     = excluded.objective,
           metric        = excluded.metric,
           metric_type   = excluded.metric_type,
           current_value = excluded.current_value,
           target_value  = excluded.target_value,
           deadline      = excluded.deadline,
           owner_user_id = excluded.owner_user_id,
           priority      = excluded.priority,
           status        = excluded.status`,
        [
          goal.id,
          goal.tenantId,
          goal.objective,
          goal.metric,
          goal.metricType ?? null,
          goal.baselineValue,
          goal.currentValue,
          goal.targetValue,
          goal.deadline,
          goal.ownerUserId ?? null,
          goal.priority,
          goal.status,
          goal.createdAt,
        ]
      )
    );
  }

  async findAllForTenant(tenantId: string): Promise<Goal[]> {
    const result = await runWithTenantContext(this.pool, tenantId, (client) =>
      client.query<GoalRow>(`select * from goal where tenant_id = $1 order by deadline asc`, [tenantId])
    );
    return result.rows.map(rowToGoal);
  }

  async findById(tenantId: string, id: string): Promise<Goal | null> {
    const result = await runWithTenantContext(this.pool, tenantId, (client) =>
      client.query<GoalRow>(`select * from goal where tenant_id = $1 and id = $2`, [tenantId, id])
    );
    return result.rows[0] ? rowToGoal(result.rows[0]) : null;
  }
}

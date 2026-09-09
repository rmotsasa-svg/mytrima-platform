import { Pool } from "pg";
import { SalesTarget, SalesTargetStore } from "./sales-target.service";
import { runWithTenantContext } from "../../common/postgres";

interface SalesTargetRow {
  id: string;
  tenant_id: string;
  user_id: string | null;
  period_start: Date;
  period_end: Date;
  target_amount: string;
  created_at: Date;
}

function rowToTarget(row: SalesTargetRow): SalesTarget {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    userId: row.user_id ?? undefined,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    targetAmount: Number(row.target_amount),
    createdAt: row.created_at,
  };
}

/** Real Postgres-backed SalesTargetStore, against `sales_target`
 * (db/migrations/0009_sales.sql). */
export class PgSalesTargetStore implements SalesTargetStore {
  constructor(private readonly pool: Pool) {}

  async save(target: SalesTarget): Promise<void> {
    await runWithTenantContext(this.pool, target.tenantId, (client) =>
      client.query(
        `insert into sales_target (id, tenant_id, user_id, period_start, period_end, target_amount) values ($1, $2, $3, $4, $5, $6)`,
        [target.id, target.tenantId, target.userId ?? null, target.periodStart, target.periodEnd, target.targetAmount]
      )
    );
  }

  async findAllForTenant(tenantId: string): Promise<SalesTarget[]> {
    const result = await runWithTenantContext(this.pool, tenantId, (client) =>
      client.query<SalesTargetRow>(`select * from sales_target where tenant_id = $1 order by period_start asc`, [tenantId])
    );
    return result.rows.map(rowToTarget);
  }
}

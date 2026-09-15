import { Pool } from "pg";
import { CommissionRate, CommissionRateStore } from "./commission.service";
import { runWithTenantContext } from "../../common/postgres";

interface CommissionRateRow {
  id: string;
  tenant_id: string;
  user_id: string;
  rate_percent: string;
  created_at: Date;
}

function rowToRate(row: CommissionRateRow): CommissionRate {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    userId: row.user_id,
    ratePercent: Number(row.rate_percent),
    createdAt: row.created_at,
  };
}

/** Real Postgres-backed CommissionRateStore, against `commission_rate`
 * (db/migrations/0042_commission_rates.sql). */
export class PgCommissionRateStore implements CommissionRateStore {
  constructor(private readonly pool: Pool) {}

  async save(rate: CommissionRate): Promise<void> {
    await runWithTenantContext(this.pool, rate.tenantId, (client) =>
      client.query(
        // Upserts on (tenant_id, user_id) — see commission.service.ts's
        // own top comment on why there is only ever one active rate per
        // staff member. created_at deliberately excluded from the update
        // set, same "never overwritten by a later save()" discipline as
        // every other store in this codebase.
        `insert into commission_rate (id, tenant_id, user_id, rate_percent)
         values ($1, $2, $3, $4)
         on conflict (tenant_id, user_id) do update set
           rate_percent = excluded.rate_percent`,
        [rate.id, rate.tenantId, rate.userId, rate.ratePercent]
      )
    );
  }

  async findForUser(tenantId: string, userId: string): Promise<CommissionRate | null> {
    const result = await runWithTenantContext(this.pool, tenantId, (client) =>
      client.query<CommissionRateRow>(`select * from commission_rate where tenant_id = $1 and user_id = $2`, [tenantId, userId])
    );
    return result.rows[0] ? rowToRate(result.rows[0]) : null;
  }

  async findAllForTenant(tenantId: string): Promise<CommissionRate[]> {
    const result = await runWithTenantContext(this.pool, tenantId, (client) =>
      client.query<CommissionRateRow>(`select * from commission_rate where tenant_id = $1`, [tenantId])
    );
    return result.rows.map(rowToRate);
  }
}

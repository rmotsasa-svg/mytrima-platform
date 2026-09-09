import { Pool } from "pg";
import { PettyCashTransaction, PettyCashStore } from "./petty-cash.service";
import { runWithTenantContext } from "../../common/postgres";

interface PettyCashRow {
  id: string;
  tenant_id: string;
  vendor_id: string | null;
  type: "replenishment" | "vendor_payment";
  amount: string;
  description: string | null;
  recorded_by_user_id: string | null;
  occurred_at: Date;
}

function rowToTransaction(row: PettyCashRow): PettyCashTransaction {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    vendorId: row.vendor_id ?? undefined,
    type: row.type,
    amount: Number(row.amount),
    description: row.description ?? undefined,
    recordedByUserId: row.recorded_by_user_id ?? undefined,
    occurredAt: row.occurred_at,
  };
}

/** Real Postgres-backed PettyCashStore, against `petty_cash_transaction`
 * (db/migrations/0010_petty_cash.sql). */
export class PgPettyCashStore implements PettyCashStore {
  constructor(private readonly pool: Pool) {}

  async save(transaction: PettyCashTransaction): Promise<void> {
    await runWithTenantContext(this.pool, transaction.tenantId, (client) =>
      client.query(
        `insert into petty_cash_transaction (id, tenant_id, vendor_id, type, amount, description, recorded_by_user_id, occurred_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          transaction.id,
          transaction.tenantId,
          transaction.vendorId ?? null,
          transaction.type,
          transaction.amount,
          transaction.description ?? null,
          transaction.recordedByUserId ?? null,
          transaction.occurredAt,
        ]
      )
    );
  }

  async findAllForTenant(tenantId: string): Promise<PettyCashTransaction[]> {
    const result = await runWithTenantContext(this.pool, tenantId, (client) =>
      client.query<PettyCashRow>(`select * from petty_cash_transaction where tenant_id = $1 order by occurred_at asc`, [tenantId])
    );
    return result.rows.map(rowToTransaction);
  }
}

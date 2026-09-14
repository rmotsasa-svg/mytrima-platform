import { Pool } from "pg";
import { ShiftBanking, ShiftBankingStore } from "./shift-banking.service";
import { runWithTenantContext } from "../../common/postgres";

interface ShiftBankingRow {
  id: string;
  tenant_id: string;
  period_start: Date;
  period_end: Date;
  expected_cash_amount: string;
  counted_cash_amount: string;
  banked_amount: string;
  notes: string | null;
  recorded_by_user_id: string | null;
  created_at: Date;
}

function rowToRecord(row: ShiftBankingRow): ShiftBanking {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    expectedCashAmount: Number(row.expected_cash_amount),
    countedCashAmount: Number(row.counted_cash_amount),
    bankedAmount: Number(row.banked_amount),
    notes: row.notes ?? undefined,
    recordedByUserId: row.recorded_by_user_id ?? undefined,
    createdAt: row.created_at,
  };
}

/** Real Postgres-backed ShiftBankingStore, against `shift_banking`
 * (db/migrations/0031_payment_method_and_shift_banking.sql). Append-only —
 * a real cash-up record is never edited after the fact, same reasoning as
 * StaffActivityLogStore. */
export class PgShiftBankingStore implements ShiftBankingStore {
  constructor(private readonly pool: Pool) {}

  async save(record: ShiftBanking): Promise<void> {
    await runWithTenantContext(this.pool, record.tenantId, (client) =>
      client.query(
        `insert into shift_banking
           (id, tenant_id, period_start, period_end, expected_cash_amount, counted_cash_amount, banked_amount, notes, recorded_by_user_id)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          record.id,
          record.tenantId,
          record.periodStart,
          record.periodEnd,
          record.expectedCashAmount,
          record.countedCashAmount,
          record.bankedAmount,
          record.notes ?? null,
          record.recordedByUserId ?? null,
        ]
      )
    );
  }

  async findAllForTenant(tenantId: string): Promise<ShiftBanking[]> {
    const result = await runWithTenantContext(this.pool, tenantId, (client) =>
      client.query<ShiftBankingRow>(`select * from shift_banking where tenant_id = $1 order by created_at desc`, [tenantId])
    );
    return result.rows.map(rowToRecord);
  }
}

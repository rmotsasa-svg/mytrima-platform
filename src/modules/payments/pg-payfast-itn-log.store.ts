import { Pool } from "pg";
import { PayfastItnLogEntry, PayfastItnLogStore } from "./payfast-itn-log.service";
import { runWithTenantContext } from "../../common/postgres";

interface PayfastItnLogRow {
  id: string;
  tenant_id: string;
  m_payment_id: string;
  pf_payment_id: string;
  payment_status: string;
  amount_gross: string | null;
  signature_valid: boolean;
  server_confirmed: boolean;
  raw_payload: Record<string, string>;
  received_at: Date;
}

function rowToEntry(row: PayfastItnLogRow): PayfastItnLogEntry {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    mPaymentId: row.m_payment_id,
    pfPaymentId: row.pf_payment_id,
    paymentStatus: row.payment_status,
    amountGross: row.amount_gross ?? undefined,
    signatureValid: row.signature_valid,
    serverConfirmed: row.server_confirmed,
    rawPayload: row.raw_payload,
    receivedAt: row.received_at,
  };
}

/** Real Postgres-backed PayfastItnLogStore, against `payfast_itn_log`
 * (db/migrations/0015_payfast.sql). */
export class PgPayfastItnLogStore implements PayfastItnLogStore {
  constructor(private readonly pool: Pool) {}

  async save(entry: PayfastItnLogEntry): Promise<void> {
    await runWithTenantContext(this.pool, entry.tenantId, (client) =>
      client.query(
        `insert into payfast_itn_log
           (id, tenant_id, m_payment_id, pf_payment_id, payment_status, amount_gross, signature_valid, server_confirmed, raw_payload)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          entry.id,
          entry.tenantId,
          entry.mPaymentId,
          entry.pfPaymentId,
          entry.paymentStatus,
          entry.amountGross ?? null,
          entry.signatureValid,
          entry.serverConfirmed,
          JSON.stringify(entry.rawPayload),
        ]
      )
    );
  }

  async findByTenant(tenantId: string): Promise<PayfastItnLogEntry[]> {
    const result = await runWithTenantContext(this.pool, tenantId, (client) =>
      client.query<PayfastItnLogRow>(`select * from payfast_itn_log where tenant_id = $1 order by received_at desc`, [tenantId])
    );
    return result.rows.map(rowToEntry);
  }
}

import { Pool } from "pg";
import { PaidTier, SubscriptionPayment, SubscriptionPaymentStore } from "./subscription.service";
import { runWithTenantContext } from "../../common/postgres";

interface SubscriptionPaymentRow {
  id: string;
  tenant_id: string;
  tier: string;
  amount_zar: string;
  mopay_session_id: string;
  mopay_reference: string;
  status: string;
  created_at: Date;
  paid_at: Date | null;
}

function rowToPayment(row: SubscriptionPaymentRow): SubscriptionPayment {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    tier: row.tier as PaidTier,
    amountZar: Number(row.amount_zar),
    mopaySessionId: row.mopay_session_id,
    mopayReference: row.mopay_reference,
    status: row.status as SubscriptionPayment["status"],
    createdAt: row.created_at,
    paidAt: row.paid_at ?? undefined,
  };
}

/** Real Postgres-backed SubscriptionPaymentStore, against
 * `tenant_subscription_payment` (db/migrations/0048). The real
 * `tenant_subscription_payment_pending_idx` unique partial index (status
 * = 'pending') is what actually enforces "at most one pending payment
 * per tenant" — this store's own on-conflict-update on `id` handles the
 * ordinary "same row, later status" save path, not that constraint;
 * SubscriptionService's own findPendingForTenant() check before creating
 * a new session is the application-level half of the same guarantee. */
export class PgSubscriptionPaymentStore implements SubscriptionPaymentStore {
  constructor(private readonly pool: Pool) {}

  async save(payment: SubscriptionPayment): Promise<void> {
    await runWithTenantContext(this.pool, payment.tenantId, (client) =>
      client.query(
        `insert into tenant_subscription_payment (id, tenant_id, tier, amount_zar, mopay_session_id, mopay_reference, status, created_at, paid_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         on conflict (id) do update set
           status  = excluded.status,
           paid_at = excluded.paid_at`,
        [
          payment.id,
          payment.tenantId,
          payment.tier,
          payment.amountZar,
          payment.mopaySessionId,
          payment.mopayReference,
          payment.status,
          payment.createdAt,
          payment.paidAt ?? null,
        ]
      )
    );
  }

  async findPendingForTenant(tenantId: string): Promise<SubscriptionPayment | null> {
    const result = await runWithTenantContext(this.pool, tenantId, (client) =>
      client.query<SubscriptionPaymentRow>(`select * from tenant_subscription_payment where tenant_id = $1 and status = 'pending'`, [tenantId])
    );
    return result.rows[0] ? rowToPayment(result.rows[0]) : null;
  }

  async listForTenant(tenantId: string): Promise<SubscriptionPayment[]> {
    const result = await runWithTenantContext(this.pool, tenantId, (client) =>
      client.query<SubscriptionPaymentRow>(`select * from tenant_subscription_payment where tenant_id = $1 order by created_at desc`, [tenantId])
    );
    return result.rows.map(rowToPayment);
  }
}

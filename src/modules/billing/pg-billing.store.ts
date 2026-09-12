import { Pool } from "pg";
import { SubscriptionStore, SubscriptionPaymentStore, TenantSubscription, SubscriptionPayment, SubscriptionPaymentStatus } from "./billing.service";
import { runWithTenantContext } from "../../common/postgres";

interface SubscriptionRow {
  tenant_id: string;
  package: string;
  status: "active" | "inactive";
  current_period_start: Date | null;
  current_period_end: Date | null;
  updated_at: Date;
}

function rowToSubscription(row: SubscriptionRow): TenantSubscription {
  return {
    tenantId: row.tenant_id,
    package: row.package,
    status: row.status,
    currentPeriodStart: row.current_period_start ?? undefined,
    currentPeriodEnd: row.current_period_end ?? undefined,
    updatedAt: row.updated_at,
  };
}

/** Real Postgres-backed SubscriptionStore, against `tenant_subscription`
 * (db/migrations/0027_tenant_billing.sql). Same runWithTenantContext
 * pattern as every other real store here. One row per tenant
 * (`tenant_id` is the primary key), so save() is a real upsert. */
export class PgSubscriptionStore implements SubscriptionStore {
  constructor(private readonly pool: Pool) {}

  async find(tenantId: string): Promise<TenantSubscription | null> {
    const result = await runWithTenantContext(this.pool, tenantId, (client) =>
      client.query<SubscriptionRow>(`select * from tenant_subscription where tenant_id = $1`, [tenantId])
    );
    return result.rows[0] ? rowToSubscription(result.rows[0]) : null;
  }

  async save(subscription: TenantSubscription): Promise<void> {
    await runWithTenantContext(this.pool, subscription.tenantId, (client) =>
      client.query(
        `insert into tenant_subscription (tenant_id, package, status, current_period_start, current_period_end, updated_at)
         values ($1, $2, $3, $4, $5, $6)
         on conflict (tenant_id) do update set
           package               = excluded.package,
           status                = excluded.status,
           current_period_start  = excluded.current_period_start,
           current_period_end    = excluded.current_period_end,
           updated_at            = excluded.updated_at`,
        [
          subscription.tenantId,
          subscription.package,
          subscription.status,
          subscription.currentPeriodStart ?? null,
          subscription.currentPeriodEnd ?? null,
          subscription.updatedAt,
        ]
      )
    );
  }
}

interface SubscriptionPaymentRow {
  id: string;
  tenant_id: string;
  package: string;
  amount: string;
  mopay_session_id: string;
  mopay_reference: string;
  status: SubscriptionPaymentStatus;
  created_at: Date;
  completed_at: Date | null;
}

function rowToPayment(row: SubscriptionPaymentRow): SubscriptionPayment {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    package: row.package,
    amount: Number(row.amount),
    mopaySessionId: row.mopay_session_id,
    mopayReference: row.mopay_reference,
    status: row.status,
    createdAt: row.created_at,
    completedAt: row.completed_at ?? undefined,
  };
}

/** Real Postgres-backed SubscriptionPaymentStore, against
 * `subscription_payment` (same migration). */
export class PgSubscriptionPaymentStore implements SubscriptionPaymentStore {
  constructor(private readonly pool: Pool) {}

  async save(payment: SubscriptionPayment): Promise<void> {
    await runWithTenantContext(this.pool, payment.tenantId, (client) =>
      client.query(
        `insert into subscription_payment (id, tenant_id, package, amount, mopay_session_id, mopay_reference, status, created_at, completed_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         on conflict (id) do update set
           status       = excluded.status,
           completed_at = excluded.completed_at`,
        [
          payment.id,
          payment.tenantId,
          payment.package,
          payment.amount,
          payment.mopaySessionId,
          payment.mopayReference,
          payment.status,
          payment.createdAt,
          payment.completedAt ?? null,
        ]
      )
    );
  }

  async findById(tenantId: string, id: string): Promise<SubscriptionPayment | null> {
    const result = await runWithTenantContext(this.pool, tenantId, (client) =>
      client.query<SubscriptionPaymentRow>(`select * from subscription_payment where tenant_id = $1 and id = $2`, [tenantId, id])
    );
    return result.rows[0] ? rowToPayment(result.rows[0]) : null;
  }

  async findByMoPaySessionId(tenantId: string, mopaySessionId: string): Promise<SubscriptionPayment | null> {
    const result = await runWithTenantContext(this.pool, tenantId, (client) =>
      client.query<SubscriptionPaymentRow>(`select * from subscription_payment where tenant_id = $1 and mopay_session_id = $2`, [
        tenantId,
        mopaySessionId,
      ])
    );
    return result.rows[0] ? rowToPayment(result.rows[0]) : null;
  }

  async listForTenant(tenantId: string): Promise<SubscriptionPayment[]> {
    return runWithTenantContext(this.pool, tenantId, async (client) => {
      const result = await client.query<SubscriptionPaymentRow>(
        `select * from subscription_payment where tenant_id = $1 order by created_at desc`,
        [tenantId]
      );
      return result.rows.map(rowToPayment);
    });
  }
}

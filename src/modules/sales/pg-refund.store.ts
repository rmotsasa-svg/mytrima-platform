import { Pool } from "pg";
import { SaleRefund, RefundStore, RefundLineItemInput } from "./refund.service";
import { runWithTenantContext } from "../../common/postgres";

interface RefundRow {
  id: string;
  tenant_id: string;
  sale_id: string;
  reason: string | null;
  refund_amount: string;
  line_items: RefundLineItemInput[];
  recorded_by_user_id: string | null;
  created_at: Date;
}

function rowToRefund(row: RefundRow): SaleRefund {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    saleId: row.sale_id,
    reason: row.reason ?? undefined,
    refundAmount: Number(row.refund_amount),
    lineItems: row.line_items,
    recordedByUserId: row.recorded_by_user_id ?? undefined,
    createdAt: row.created_at,
  };
}

/** Real Postgres-backed RefundStore, against `sale_refund`
 * (db/migrations/0028_sale_refund.sql) — see that migration's own comment
 * on why `line_items` is a single jsonb column rather than a child table. */
export class PgRefundStore implements RefundStore {
  constructor(private readonly pool: Pool) {}

  async save(refund: SaleRefund): Promise<void> {
    await runWithTenantContext(this.pool, refund.tenantId, (client) =>
      client.query(
        `insert into sale_refund (id, tenant_id, sale_id, reason, refund_amount, line_items, recorded_by_user_id)
         values ($1, $2, $3, $4, $5, $6, $7)`,
        [refund.id, refund.tenantId, refund.saleId, refund.reason ?? null, refund.refundAmount, JSON.stringify(refund.lineItems), refund.recordedByUserId ?? null]
      )
    );
  }

  async findAllForSale(tenantId: string, saleId: string): Promise<SaleRefund[]> {
    const result = await runWithTenantContext(this.pool, tenantId, (client) =>
      client.query<RefundRow>(`select * from sale_refund where tenant_id = $1 and sale_id = $2 order by created_at asc`, [tenantId, saleId])
    );
    return result.rows.map(rowToRefund);
  }

  async findAllForTenant(tenantId: string, periodStart?: Date, periodEnd?: Date): Promise<SaleRefund[]> {
    return runWithTenantContext(this.pool, tenantId, async (client) => {
      const conditions = ["tenant_id = $1"];
      const params: unknown[] = [tenantId];
      if (periodStart) {
        params.push(periodStart);
        conditions.push(`created_at >= $${params.length}`);
      }
      if (periodEnd) {
        params.push(periodEnd);
        conditions.push(`created_at <= $${params.length}`);
      }
      const result = await client.query<RefundRow>(`select * from sale_refund where ${conditions.join(" and ")} order by created_at asc`, params);
      return result.rows.map(rowToRefund);
    });
  }
}

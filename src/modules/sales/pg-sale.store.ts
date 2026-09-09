import { Pool } from "pg";
import { SaleTransaction, SaleStore, SaleLineItem, SaleSource } from "./sale.service";
import { runWithTenantContext } from "../../common/postgres";

interface SaleRow {
  id: string;
  tenant_id: string;
  customer_id: string | null;
  recorded_by_user_id: string | null;
  source: SaleSource;
  occurred_at: Date;
  subtotal_amount: string;
  discount_amount: string;
  total_amount: string;
  deal_id: string | null;
  created_at: Date;
}

interface LineItemRow {
  id: string;
  sale_transaction_id: string;
  catalog_item_id: string | null;
  description: string | null;
  quantity: string;
  unit_price: string;
  is_addon: boolean;
}

function rowToLineItem(row: LineItemRow): SaleLineItem {
  return {
    id: row.id,
    catalogItemId: row.catalog_item_id ?? undefined,
    description: row.description ?? undefined,
    quantity: Number(row.quantity),
    unitPrice: Number(row.unit_price),
    isAddon: row.is_addon,
  };
}

function rowToTransaction(row: SaleRow, lineItems: SaleLineItem[]): SaleTransaction {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    customerId: row.customer_id ?? undefined,
    recordedByUserId: row.recorded_by_user_id ?? undefined,
    source: row.source,
    occurredAt: row.occurred_at,
    subtotalAmount: Number(row.subtotal_amount),
    discountAmount: Number(row.discount_amount),
    totalAmount: Number(row.total_amount),
    dealId: row.deal_id ?? undefined,
    lineItems,
    createdAt: row.created_at,
  };
}

/** Real Postgres-backed SaleStore, against `sale_transaction` +
 * `sale_transaction_line_item` (db/migrations/0009_sales.sql). Both written
 * inside one runWithTenantContext transaction, same pattern as PgDealStore. */
export class PgSaleStore implements SaleStore {
  constructor(private readonly pool: Pool) {}

  async save(transaction: SaleTransaction): Promise<void> {
    await runWithTenantContext(this.pool, transaction.tenantId, async (client) => {
      await client.query(
        `insert into sale_transaction
           (id, tenant_id, customer_id, recorded_by_user_id, source, occurred_at, subtotal_amount, discount_amount, total_amount, deal_id)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          transaction.id,
          transaction.tenantId,
          transaction.customerId ?? null,
          transaction.recordedByUserId ?? null,
          transaction.source,
          transaction.occurredAt,
          transaction.subtotalAmount,
          transaction.discountAmount,
          transaction.totalAmount,
          transaction.dealId ?? null,
        ]
      );
      for (const item of transaction.lineItems) {
        await client.query(
          `insert into sale_transaction_line_item
             (id, tenant_id, sale_transaction_id, catalog_item_id, description, quantity, unit_price, is_addon)
           values ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [item.id, transaction.tenantId, transaction.id, item.catalogItemId ?? null, item.description ?? null, item.quantity, item.unitPrice, item.isAddon]
        );
      }
    });
  }

  async findAllForTenant(tenantId: string, periodStart?: Date, periodEnd?: Date): Promise<SaleTransaction[]> {
    return runWithTenantContext(this.pool, tenantId, async (client) => {
      const conditions = ["tenant_id = $1"];
      const params: unknown[] = [tenantId];
      if (periodStart) {
        params.push(periodStart);
        conditions.push(`occurred_at >= $${params.length}`);
      }
      if (periodEnd) {
        params.push(periodEnd);
        conditions.push(`occurred_at <= $${params.length}`);
      }
      const sales = await client.query<SaleRow>(
        `select * from sale_transaction where ${conditions.join(" and ")} order by occurred_at asc`,
        params
      );
      const result: SaleTransaction[] = [];
      for (const row of sales.rows) {
        const items = await client.query<LineItemRow>(`select * from sale_transaction_line_item where sale_transaction_id = $1`, [row.id]);
        result.push(rowToTransaction(row, items.rows.map(rowToLineItem)));
      }
      return result;
    });
  }
}

import { Pool } from "pg";
import { Quotation, QuotationStore, QuotationLineItem, QuotationStatus } from "./quotation.service";
import { runWithTenantContext } from "../../common/postgres";

interface QuotationRow {
  id: string;
  tenant_id: string;
  quote_number: string;
  customer_id: string | null;
  subtotal_amount: string;
  discount_amount: string;
  total_amount: string;
  notes: string | null;
  customer_address: string | null;
  valid_until: Date | null;
  status: QuotationStatus;
  created_by_user_id: string | null;
  created_at: Date;
  sent_at: Date | null;
}

interface LineItemRow {
  id: string;
  quotation_id: string;
  catalog_item_id: string | null;
  description: string | null;
  quantity: string;
  unit_price: string;
}

function rowToLineItem(row: LineItemRow): QuotationLineItem {
  return {
    id: row.id,
    catalogItemId: row.catalog_item_id ?? undefined,
    description: row.description ?? undefined,
    quantity: Number(row.quantity),
    unitPrice: Number(row.unit_price),
  };
}

function rowToQuotation(row: QuotationRow, lineItems: QuotationLineItem[]): Quotation {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    quoteNumber: row.quote_number,
    customerId: row.customer_id ?? undefined,
    lineItems,
    subtotalAmount: Number(row.subtotal_amount),
    discountAmount: Number(row.discount_amount),
    totalAmount: Number(row.total_amount),
    notes: row.notes ?? undefined,
    customerAddress: row.customer_address ?? undefined,
    validUntil: row.valid_until ?? undefined,
    status: row.status,
    createdByUserId: row.created_by_user_id ?? undefined,
    createdAt: row.created_at,
    sentAt: row.sent_at ?? undefined,
  };
}

/** Real Postgres-backed QuotationStore, against `quotation` +
 * `quotation_line_item` (db/migrations/0043_quotations.sql). Same
 * "on conflict do update" header + "delete and reinsert" line items
 * pattern already proven by PgDealStore. */
export class PgQuotationStore implements QuotationStore {
  constructor(private readonly pool: Pool) {}

  async save(quotation: Quotation): Promise<void> {
    await runWithTenantContext(this.pool, quotation.tenantId, async (client) => {
      await client.query(
        // quote_number/created_at/created_by_user_id deliberately excluded
        // from the update set — all three must stay the row's real
        // original values, never overwritten by a later save() (e.g.
        // update()/markSent()), same discipline as every other store in
        // this codebase.
        `insert into quotation (id, tenant_id, quote_number, customer_id, subtotal_amount, discount_amount, total_amount, notes, customer_address, valid_until, status, created_by_user_id, sent_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
         on conflict (id) do update set
           customer_id      = excluded.customer_id,
           subtotal_amount  = excluded.subtotal_amount,
           discount_amount  = excluded.discount_amount,
           total_amount     = excluded.total_amount,
           notes            = excluded.notes,
           customer_address = excluded.customer_address,
           valid_until      = excluded.valid_until,
           status           = excluded.status,
           sent_at          = excluded.sent_at`,
        [
          quotation.id,
          quotation.tenantId,
          quotation.quoteNumber,
          quotation.customerId ?? null,
          quotation.subtotalAmount,
          quotation.discountAmount,
          quotation.totalAmount,
          quotation.notes ?? null,
          quotation.customerAddress ?? null,
          quotation.validUntil ?? null,
          quotation.status,
          quotation.createdByUserId ?? null,
          quotation.sentAt ?? null,
        ]
      );
      await client.query(`delete from quotation_line_item where quotation_id = $1`, [quotation.id]);
      for (const item of quotation.lineItems) {
        await client.query(
          `insert into quotation_line_item (id, tenant_id, quotation_id, catalog_item_id, description, quantity, unit_price)
           values ($1, $2, $3, $4, $5, $6, $7)`,
          [item.id, quotation.tenantId, quotation.id, item.catalogItemId ?? null, item.description ?? null, item.quantity, item.unitPrice]
        );
      }
    });
  }

  async findAllForTenant(tenantId: string): Promise<Quotation[]> {
    return runWithTenantContext(this.pool, tenantId, async (client) => {
      const quotations = await client.query<QuotationRow>(`select * from quotation where tenant_id = $1 order by created_at desc`, [tenantId]);
      const result: Quotation[] = [];
      for (const row of quotations.rows) {
        const items = await client.query<LineItemRow>(`select * from quotation_line_item where quotation_id = $1`, [row.id]);
        result.push(rowToQuotation(row, items.rows.map(rowToLineItem)));
      }
      return result;
    });
  }

  async findById(tenantId: string, id: string): Promise<Quotation | null> {
    return runWithTenantContext(this.pool, tenantId, async (client) => {
      const quotations = await client.query<QuotationRow>(`select * from quotation where id = $1`, [id]);
      const row = quotations.rows[0];
      if (!row) return null;
      const items = await client.query<LineItemRow>(`select * from quotation_line_item where quotation_id = $1`, [row.id]);
      return rowToQuotation(row, items.rows.map(rowToLineItem));
    });
  }
}

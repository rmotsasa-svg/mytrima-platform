import { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { Deal, DealStore, DiscountType } from "./deal.service";
import { runWithTenantContext } from "../../common/postgres";

interface DealRow {
  id: string;
  tenant_id: string;
  name: string;
  discount_type: DiscountType;
  percentage_off: string | null;
  buy_quantity: number | null;
  free_quantity: number | null;
  fixed_amount_off: string | null;
  starts_at: Date | null;
  ends_at: Date | null;
  is_active: boolean;
  created_at: Date;
}

function rowToDeal(row: DealRow, catalogItemIds: string[]): Deal {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    name: row.name,
    discountType: row.discount_type,
    percentageOff: row.percentage_off !== null ? Number(row.percentage_off) : undefined,
    buyQuantity: row.buy_quantity ?? undefined,
    freeQuantity: row.free_quantity ?? undefined,
    fixedAmountOff: row.fixed_amount_off !== null ? Number(row.fixed_amount_off) : undefined,
    startsAt: row.starts_at ?? undefined,
    endsAt: row.ends_at ?? undefined,
    isActive: row.is_active,
    catalogItemIds,
    createdAt: row.created_at,
  };
}

/** Real Postgres-backed DealStore, against `deal` + `deal_catalog_item`
 * (db/migrations/0008_deals.sql). Both tables written inside one
 * runWithTenantContext transaction so a deal and its catalog-item links are
 * never left inconsistent. */
export class PgDealStore implements DealStore {
  constructor(private readonly pool: Pool) {}

  async save(deal: Deal): Promise<void> {
    await runWithTenantContext(this.pool, deal.tenantId, async (client) => {
      await client.query(
        `insert into deal (id, tenant_id, name, discount_type, percentage_off, buy_quantity, free_quantity, fixed_amount_off, starts_at, ends_at, is_active)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         on conflict (id) do update set
           name = excluded.name, percentage_off = excluded.percentage_off, buy_quantity = excluded.buy_quantity,
           free_quantity = excluded.free_quantity, fixed_amount_off = excluded.fixed_amount_off,
           starts_at = excluded.starts_at, ends_at = excluded.ends_at, is_active = excluded.is_active`,
        [
          deal.id,
          deal.tenantId,
          deal.name,
          deal.discountType,
          deal.percentageOff ?? null,
          deal.buyQuantity ?? null,
          deal.freeQuantity ?? null,
          deal.fixedAmountOff ?? null,
          deal.startsAt ?? null,
          deal.endsAt ?? null,
          deal.isActive,
        ]
      );
      await client.query(`delete from deal_catalog_item where deal_id = $1`, [deal.id]);
      for (const catalogItemId of deal.catalogItemIds) {
        await client.query(`insert into deal_catalog_item (id, tenant_id, deal_id, catalog_item_id) values ($1, $2, $3, $4)`, [
          randomUUID(),
          deal.tenantId,
          deal.id,
          catalogItemId,
        ]);
      }
    });
  }

  async findAllForTenant(tenantId: string): Promise<Deal[]> {
    return runWithTenantContext(this.pool, tenantId, async (client) => {
      const deals = await client.query<DealRow>(`select * from deal where tenant_id = $1 order by created_at asc`, [tenantId]);
      const result: Deal[] = [];
      for (const row of deals.rows) {
        const links = await client.query<{ catalog_item_id: string }>(`select catalog_item_id from deal_catalog_item where deal_id = $1`, [row.id]);
        result.push(rowToDeal(row, links.rows.map((l) => l.catalog_item_id)));
      }
      return result;
    });
  }

  async findById(tenantId: string, id: string): Promise<Deal | null> {
    return runWithTenantContext(this.pool, tenantId, async (client) => {
      const deals = await client.query<DealRow>(`select * from deal where id = $1`, [id]);
      const row = deals.rows[0];
      if (!row) return null;
      const links = await client.query<{ catalog_item_id: string }>(`select catalog_item_id from deal_catalog_item where deal_id = $1`, [row.id]);
      return rowToDeal(row, links.rows.map((l) => l.catalog_item_id));
    });
  }
}

import { Pool } from "pg";
import { CatalogItem, CatalogItemStore } from "./catalog-item.service";
import { runWithTenantContext } from "../../common/postgres";

interface CatalogItemRow {
  id: string;
  tenant_id: string;
  name: string;
  item_type: "product" | "service";
  sku: string | null;
  unit_price: string;
  is_active: boolean;
  created_at: Date;
}

function rowToItem(row: CatalogItemRow): CatalogItem {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    name: row.name,
    itemType: row.item_type,
    sku: row.sku ?? undefined,
    unitPrice: Number(row.unit_price),
    isActive: row.is_active,
    createdAt: row.created_at,
  };
}

/** Real Postgres-backed CatalogItemStore, against `catalog_item`
 * (db/migrations/0007_catalog.sql). Same runWithTenantContext pattern as
 * every other real store in this codebase — see src/common/postgres.ts. */
export class PgCatalogItemStore implements CatalogItemStore {
  constructor(private readonly pool: Pool) {}

  async save(item: CatalogItem): Promise<void> {
    await runWithTenantContext(this.pool, item.tenantId, (client) =>
      client.query(
        `insert into catalog_item (id, tenant_id, name, item_type, sku, unit_price, is_active)
         values ($1, $2, $3, $4, $5, $6, $7)
         on conflict (id) do update set
           name = excluded.name, sku = excluded.sku, unit_price = excluded.unit_price, is_active = excluded.is_active`,
        [item.id, item.tenantId, item.name, item.itemType, item.sku ?? null, item.unitPrice, item.isActive]
      )
    );
  }

  async findAllForTenant(tenantId: string): Promise<CatalogItem[]> {
    const result = await runWithTenantContext(this.pool, tenantId, (client) =>
      client.query<CatalogItemRow>(`select * from catalog_item where tenant_id = $1 order by created_at asc`, [tenantId])
    );
    return result.rows.map(rowToItem);
  }

  async findById(tenantId: string, id: string): Promise<CatalogItem | null> {
    const result = await runWithTenantContext(this.pool, tenantId, (client) =>
      client.query<CatalogItemRow>(`select * from catalog_item where id = $1`, [id])
    );
    return result.rows[0] ? rowToItem(result.rows[0]) : null;
  }
}

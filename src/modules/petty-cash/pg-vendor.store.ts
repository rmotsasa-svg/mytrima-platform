import { Pool } from "pg";
import { Vendor, VendorStore } from "./vendor.service";
import { runWithTenantContext } from "../../common/postgres";

interface VendorRow {
  id: string;
  tenant_id: string;
  name: string;
  contact_info: string | null;
  is_active: boolean;
  created_at: Date;
}

function rowToVendor(row: VendorRow): Vendor {
  return { id: row.id, tenantId: row.tenant_id, name: row.name, contactInfo: row.contact_info ?? undefined, isActive: row.is_active, createdAt: row.created_at };
}

/** Real Postgres-backed VendorStore, against `vendor` (db/migrations/0010_petty_cash.sql). */
export class PgVendorStore implements VendorStore {
  constructor(private readonly pool: Pool) {}

  async save(vendor: Vendor): Promise<void> {
    await runWithTenantContext(this.pool, vendor.tenantId, (client) =>
      client.query(
        `insert into vendor (id, tenant_id, name, contact_info, is_active) values ($1, $2, $3, $4, $5)
         on conflict (id) do update set name = excluded.name, contact_info = excluded.contact_info, is_active = excluded.is_active`,
        [vendor.id, vendor.tenantId, vendor.name, vendor.contactInfo ?? null, vendor.isActive]
      )
    );
  }

  async findAllForTenant(tenantId: string): Promise<Vendor[]> {
    const result = await runWithTenantContext(this.pool, tenantId, (client) =>
      client.query<VendorRow>(`select * from vendor where tenant_id = $1 order by created_at asc`, [tenantId])
    );
    return result.rows.map(rowToVendor);
  }

  async findById(tenantId: string, id: string): Promise<Vendor | null> {
    const result = await runWithTenantContext(this.pool, tenantId, (client) => client.query<VendorRow>(`select * from vendor where id = $1`, [id]));
    return result.rows[0] ? rowToVendor(result.rows[0]) : null;
  }
}

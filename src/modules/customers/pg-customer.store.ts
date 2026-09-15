import { Pool } from "pg";
import { CustomerStore, Customer, CustomerGender } from "./customer.service";
import { runWithTenantContext } from "../../common/postgres";

interface CustomerRow {
  id: string;
  tenant_id: string;
  display_name: string | null;
  phone_e164: string | null;
  email: string | null;
  gender: string | null;
  location: string | null;
  created_at: Date;
  updated_at: Date;
  created_by_user_id: string | null;
  updated_by_user_id: string | null;
}

function rowToCustomer(row: CustomerRow): Customer {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    displayName: row.display_name ?? undefined,
    phone: row.phone_e164 ?? undefined,
    email: row.email ?? undefined,
    gender: (row.gender as CustomerGender | null) ?? undefined,
    location: row.location ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdByUserId: row.created_by_user_id ?? undefined,
    updatedByUserId: row.updated_by_user_id ?? undefined,
  };
}

/**
 * Real Postgres-backed CustomerStore, against the `customer` table from
 * 0001_tenant_and_rls.sql (which has carried RLS since this scaffold's first
 * migration — this store is what was actually missing, not the table). Same
 * tenant-context-per-transaction pattern as PgRatingStore/PgConsentStore —
 * see src/common/postgres.ts.
 *
 * ACTUALLY RUN against a real local PostgreSQL 17 instance — see
 * pg-customer.store.test.ts (gated behind TEST_DATABASE_URL).
 */
export class PgCustomerStore implements CustomerStore {
  constructor(private readonly pool: Pool) {}

  async save(customer: Customer): Promise<void> {
    await runWithTenantContext(this.pool, customer.tenantId, (client) =>
      client.query(
        // created_by_user_id deliberately excluded from the `on conflict
        // do update set` list below, same "never overwritten by a later
        // save()" discipline as created_at elsewhere in this codebase —
        // who created this record must never change on an unrelated edit.
        // updated_by_user_id, unlike that, IS meant to change on every
        // save() — it tracks the most recent editor.
        `insert into customer (id, tenant_id, display_name, phone_e164, email, gender, location, created_by_user_id, updated_by_user_id, updated_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         on conflict (id) do update set
           display_name       = excluded.display_name,
           phone_e164         = excluded.phone_e164,
           email              = excluded.email,
           gender             = excluded.gender,
           location           = excluded.location,
           updated_by_user_id = excluded.updated_by_user_id,
           updated_at         = excluded.updated_at`,
        [
          customer.id,
          customer.tenantId,
          customer.displayName ?? null,
          customer.phone ?? null,
          customer.email ?? null,
          customer.gender ?? null,
          customer.location ?? null,
          customer.createdByUserId ?? null,
          customer.updatedByUserId ?? null,
          customer.updatedAt,
        ]
      )
    );
  }

  async findAllForTenant(tenantId: string): Promise<Customer[]> {
    const result = await runWithTenantContext(this.pool, tenantId, (client) =>
      client.query<CustomerRow>(`select * from customer where tenant_id = $1 order by created_at asc`, [tenantId])
    );
    return result.rows.map(rowToCustomer);
  }

  async findById(tenantId: string, id: string): Promise<Customer | null> {
    const result = await runWithTenantContext(this.pool, tenantId, (client) =>
      client.query<CustomerRow>(`select * from customer where id = $1`, [id])
    );
    return result.rows[0] ? rowToCustomer(result.rows[0]) : null;
  }
}

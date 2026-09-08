import { Pool } from "pg";
import { CustomerStore, Customer } from "./customer.service";
import { runWithTenantContext } from "../../common/postgres";

interface CustomerRow {
  id: string;
  tenant_id: string;
  display_name: string | null;
  phone_e164: string | null;
  email: string | null;
  created_at: Date;
}

function rowToCustomer(row: CustomerRow): Customer {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    displayName: row.display_name ?? undefined,
    phone: row.phone_e164 ?? undefined,
    email: row.email ?? undefined,
    createdAt: row.created_at,
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
        `insert into customer (id, tenant_id, display_name, phone_e164, email)
         values ($1, $2, $3, $4, $5)
         on conflict (id) do update set
           display_name = excluded.display_name,
           phone_e164   = excluded.phone_e164,
           email        = excluded.email`,
        [customer.id, customer.tenantId, customer.displayName ?? null, customer.phone ?? null, customer.email ?? null]
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

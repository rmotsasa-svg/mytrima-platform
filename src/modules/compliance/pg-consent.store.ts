import { Pool } from "pg";
import { ConsentStore, ConsentRecord, LawfulBasis } from "./consent.service";
import { runWithTenantContext } from "../../common/postgres";

interface ConsentRecordRow {
  id: string;
  tenant_id: string;
  customer_id: string;
  data_category: string;
  lawful_basis: LawfulBasis;
  granted_at: Date;
  revoked_at: Date | null;
}

function rowToRecord(row: ConsentRecordRow): ConsentRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    customerId: row.customer_id,
    dataCategory: row.data_category,
    lawfulBasis: row.lawful_basis,
    grantedAt: row.granted_at,
    revokedAt: row.revoked_at ?? undefined,
  };
}

/**
 * Real Postgres-backed ConsentStore, against the consent_record table from
 * 0001_tenant_and_rls.sql. Every method runs inside a transaction with
 * app.current_tenant_id set via runWithTenantContext() (src/common/postgres.ts)
 * — RLS, not just a WHERE clause, is what actually enforces tenant isolation
 * here, matching Master Plan Section 5's "defense in depth" design.
 *
 * ACTUALLY RUN against a real local PostgreSQL 17 instance — see
 * pg-consent.store.test.ts (gated behind TEST_DATABASE_URL).
 */
export class PgConsentStore implements ConsentStore {
  constructor(private readonly pool: Pool) {}

  async save(record: ConsentRecord): Promise<void> {
    await runWithTenantContext(this.pool, record.tenantId, (client) =>
      client.query(
        `insert into consent_record (id, tenant_id, customer_id, data_category, lawful_basis, granted_at, revoked_at)
         values ($1, $2, $3, $4, $5, $6, $7)
         on conflict (id) do update set
           data_category = excluded.data_category,
           lawful_basis  = excluded.lawful_basis,
           granted_at    = excluded.granted_at,
           revoked_at    = excluded.revoked_at`,
        [record.id, record.tenantId, record.customerId, record.dataCategory, record.lawfulBasis, record.grantedAt, record.revokedAt ?? null]
      )
    );
  }

  async findActive(tenantId: string, customerId: string, dataCategory: string): Promise<ConsentRecord | null> {
    const result = await runWithTenantContext(this.pool, tenantId, (client) =>
      client.query<ConsentRecordRow>(
        `select * from consent_record
         where tenant_id = $1 and customer_id = $2 and data_category = $3 and revoked_at is null
         order by granted_at desc limit 1`,
        [tenantId, customerId, dataCategory]
      )
    );
    return result.rows[0] ? rowToRecord(result.rows[0]) : null;
  }

  async findAllForCustomer(tenantId: string, customerId: string): Promise<ConsentRecord[]> {
    const result = await runWithTenantContext(this.pool, tenantId, (client) =>
      client.query<ConsentRecordRow>(`select * from consent_record where tenant_id = $1 and customer_id = $2 order by granted_at asc`, [
        tenantId,
        customerId,
      ])
    );
    return result.rows.map(rowToRecord);
  }

  async revoke(tenantId: string, id: string, revokedAt: Date): Promise<void> {
    // tenantId scopes app.current_tenant_id via runWithTenantContext, so RLS
    // alone makes this a no-op if `id` belongs to a different tenant — no
    // extra WHERE-clause check needed to get that behavior.
    await runWithTenantContext(this.pool, tenantId, (client) =>
      client.query(`update consent_record set revoked_at = $2 where id = $1`, [id, revokedAt])
    );
  }
}

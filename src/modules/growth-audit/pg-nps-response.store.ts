import { Pool } from "pg";
import { NpsResponseStore, StoredNpsResponse } from "./nps.service";
import { runWithTenantContext } from "../../common/postgres";

interface NpsResponseRow {
  id: string;
  tenant_id: string;
  customer_id: string;
  score: number;
  comment: string | null;
  submitted_at: Date;
}

function rowToResponse(row: NpsResponseRow): StoredNpsResponse {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    customerId: row.customer_id,
    score: row.score,
    comment: row.comment ?? undefined,
    submittedAt: row.submitted_at,
  };
}

/**
 * Real Postgres-backed NpsResponseStore, against the `nps_response` table
 * from 0006_nps_response.sql. Same tenant-context-per-transaction pattern as
 * every other Pg*Store — see src/common/postgres.ts.
 *
 * ACTUALLY RUN against a real local PostgreSQL 17 instance — see
 * pg-nps-response.store.test.ts (gated behind TEST_DATABASE_URL).
 */
export class PgNpsResponseStore implements NpsResponseStore {
  constructor(private readonly pool: Pool) {}

  async save(response: StoredNpsResponse): Promise<void> {
    await runWithTenantContext(this.pool, response.tenantId, (client) =>
      client.query(
        `insert into nps_response (id, tenant_id, customer_id, score, comment, submitted_at)
         values ($1, $2, $3, $4, $5, $6)`,
        [response.id, response.tenantId, response.customerId, response.score, response.comment ?? null, response.submittedAt]
      )
    );
  }

  async findAllForTenant(tenantId: string): Promise<StoredNpsResponse[]> {
    const result = await runWithTenantContext(this.pool, tenantId, (client) =>
      client.query<NpsResponseRow>(`select * from nps_response where tenant_id = $1 order by submitted_at asc`, [tenantId])
    );
    return result.rows.map(rowToResponse);
  }
}

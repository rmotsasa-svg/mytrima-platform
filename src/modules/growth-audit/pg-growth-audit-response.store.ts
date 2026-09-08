import { Pool } from "pg";
import { GrowthAuditResponseStore, GrowthAuditResponse } from "./growth-audit.service";
import { SectionResult, PerformanceBand } from "./growth-audit.service";
import { runWithTenantContext } from "../../common/postgres";

interface GrowthAuditResponseRow {
  id: string;
  tenant_id: string;
  answers: Record<number, number>;
  section_scores: SectionResult[];
  overall_score: string; // numeric(5,2) comes back as a string from node-postgres
  band: PerformanceBand;
  created_at: Date;
}

function rowToResponse(row: GrowthAuditResponseRow): GrowthAuditResponse {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    answers: row.answers,
    result: { sections: row.section_scores, overallScore: Number(row.overall_score), band: row.band },
    submittedAt: row.created_at,
  };
}

/**
 * Real Postgres-backed GrowthAuditResponseStore, against the
 * `growth_audit_response` table from 0001_tenant_and_rls.sql (which has
 * carried RLS since this scaffold's first migration — this store is what
 * was actually missing, not the table, the same shape of gap
 * PgCustomerStore closed for `customer`). Same tenant-context-per-
 * transaction pattern as every other Pg*Store — see src/common/postgres.ts.
 *
 * `answers` and `section_scores` are jsonb columns. node-postgres parses
 * jsonb back to a JS value automatically on the way out, but does NOT
 * automatically serialize every JS value to JSON on the way in: a plain
 * object gets JSON.stringify'd, but a plain array (section_scores — an
 * array of SectionResult) gets encoded as a *Postgres array literal*
 * instead (`{...}`), because pg's parameter serializer can't tell "this
 * array is going into a jsonb column" from "this array is going into a real
 * Postgres array column" — it only sees a JS array. That literal isn't
 * valid JSON, so Postgres rejects it outright.
 *
 * ACTUALLY RUN against a real local PostgreSQL 17 instance — and this exact
 * failure is exactly what running it for real caught:
 * `error: invalid input syntax for type json` the first time this store
 * tried to insert a real row, not a hypothetical. Fixed by explicitly
 * JSON.stringify-ing both jsonb fields before they ever reach node-postgres,
 * rather than relying on its automatic (and here, wrong) serialization. See
 * pg-growth-audit-response.store.test.ts (gated behind TEST_DATABASE_URL).
 */
export class PgGrowthAuditResponseStore implements GrowthAuditResponseStore {
  constructor(private readonly pool: Pool) {}

  async save(response: GrowthAuditResponse): Promise<void> {
    await runWithTenantContext(this.pool, response.tenantId, (client) =>
      client.query(
        `insert into growth_audit_response (id, tenant_id, answers, section_scores, overall_score, band, created_at)
         values ($1, $2, $3, $4, $5, $6, $7)`,
        [
          response.id,
          response.tenantId,
          JSON.stringify(response.answers),
          JSON.stringify(response.result.sections),
          response.result.overallScore,
          response.result.band,
          response.submittedAt,
        ]
      )
    );
  }

  async findAllForTenant(tenantId: string): Promise<GrowthAuditResponse[]> {
    const result = await runWithTenantContext(this.pool, tenantId, (client) =>
      client.query<GrowthAuditResponseRow>(`select * from growth_audit_response where tenant_id = $1 order by created_at asc`, [tenantId])
    );
    return result.rows.map(rowToResponse);
  }
}

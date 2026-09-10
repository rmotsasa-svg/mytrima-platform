import { Pool } from "pg";
import { RecommendationLogEntry, RecommendationStore } from "./recommendation.service";
import { SectionKey } from "./questions.data";
import { runWithTenantContext } from "../../common/postgres";

interface RecommendationRow {
  id: string;
  tenant_id: string;
  growth_audit_response_id: string;
  section_key: SectionKey;
  question_id: number;
  action_key: string;
  action_label: string;
  created_at: Date;
  action_detected_at: Date | null;
}

function rowToEntry(row: RecommendationRow): RecommendationLogEntry {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    growthAuditResponseId: row.growth_audit_response_id,
    sectionKey: row.section_key,
    questionId: row.question_id,
    actionKey: row.action_key,
    actionLabel: row.action_label,
    createdAt: row.created_at,
    actionDetectedAt: row.action_detected_at,
  };
}

/** Real Postgres-backed RecommendationStore, against `recommendation`
 * (db/migrations/0018_recommendation.sql). */
export class PgRecommendationStore implements RecommendationStore {
  constructor(private readonly pool: Pool) {}

  async save(entry: RecommendationLogEntry): Promise<void> {
    await runWithTenantContext(this.pool, entry.tenantId, (client) =>
      client.query(
        `insert into recommendation
           (id, tenant_id, growth_audit_response_id, section_key, question_id, action_key, action_label)
         values ($1, $2, $3, $4, $5, $6, $7)`,
        [entry.id, entry.tenantId, entry.growthAuditResponseId, entry.sectionKey, entry.questionId, entry.actionKey, entry.actionLabel]
      )
    );
  }

  async findAllForTenant(tenantId: string): Promise<RecommendationLogEntry[]> {
    const result = await runWithTenantContext(this.pool, tenantId, (client) =>
      client.query<RecommendationRow>(`select * from recommendation where tenant_id = $1 order by created_at desc`, [tenantId])
    );
    return result.rows.map(rowToEntry);
  }

  async markDetected(tenantId: string, id: string, detectedAt: Date): Promise<void> {
    await runWithTenantContext(this.pool, tenantId, (client) =>
      client.query(`update recommendation set action_detected_at = $1 where id = $2 and tenant_id = $3`, [detectedAt, id, tenantId])
    );
  }
}

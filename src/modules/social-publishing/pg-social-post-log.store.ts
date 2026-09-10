import { Pool } from "pg";
import { SocialPostLogEntry, SocialPostLogStore } from "./social-post-log.service";
import { runWithTenantContext } from "../../common/postgres";

interface SocialPostLogRow {
  id: string;
  tenant_id: string;
  provider: "facebook" | "instagram";
  post_id: string;
  posted_at: Date;
}

function rowToEntry(row: SocialPostLogRow): SocialPostLogEntry {
  return { id: row.id, tenantId: row.tenant_id, provider: row.provider, postId: row.post_id, postedAt: row.posted_at };
}

/** Real Postgres-backed SocialPostLogStore, against `social_post_log`
 * (db/migrations/0017_social_post_log.sql). */
export class PgSocialPostLogStore implements SocialPostLogStore {
  constructor(private readonly pool: Pool) {}

  async save(entry: SocialPostLogEntry): Promise<void> {
    await runWithTenantContext(this.pool, entry.tenantId, (client) =>
      client.query(`insert into social_post_log (id, tenant_id, provider, post_id) values ($1, $2, $3, $4)`, [
        entry.id,
        entry.tenantId,
        entry.provider,
        entry.postId,
      ])
    );
  }

  async findRecentForTenant(tenantId: string, sinceDate: Date): Promise<SocialPostLogEntry[]> {
    const result = await runWithTenantContext(this.pool, tenantId, (client) =>
      client.query<SocialPostLogRow>(`select * from social_post_log where tenant_id = $1 and posted_at >= $2 order by posted_at desc`, [
        tenantId,
        sinceDate,
      ])
    );
    return result.rows.map(rowToEntry);
  }
}

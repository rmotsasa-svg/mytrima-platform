import { Pool } from "pg";
import { SocialConnection, SocialConnectionStore } from "./social-connection.service";
import { runWithTenantContext } from "../../common/postgres";

interface SocialConnectionRow {
  id: string;
  tenant_id: string;
  provider: "facebook";
  page_id: string;
  page_name: string;
  page_access_token: string;
  connected_at: Date;
}

function rowToConnection(row: SocialConnectionRow): SocialConnection {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    provider: row.provider,
    pageId: row.page_id,
    pageName: row.page_name,
    pageAccessToken: row.page_access_token,
    connectedAt: row.connected_at,
  };
}

/** Real Postgres-backed SocialConnectionStore, against `social_connection`
 * (db/migrations/0012_social_connection.sql). */
export class PgSocialConnectionStore implements SocialConnectionStore {
  constructor(private readonly pool: Pool) {}

  async save(connection: SocialConnection): Promise<void> {
    await runWithTenantContext(this.pool, connection.tenantId, (client) =>
      client.query(
        `insert into social_connection (id, tenant_id, provider, page_id, page_name, page_access_token)
         values ($1, $2, $3, $4, $5, $6)
         on conflict (tenant_id, provider) do update set
           page_id = excluded.page_id, page_name = excluded.page_name, page_access_token = excluded.page_access_token, connected_at = now()`,
        [connection.id, connection.tenantId, connection.provider, connection.pageId, connection.pageName, connection.pageAccessToken]
      )
    );
  }

  async findByTenant(tenantId: string, provider: "facebook"): Promise<SocialConnection | null> {
    const result = await runWithTenantContext(this.pool, tenantId, (client) =>
      client.query<SocialConnectionRow>(`select * from social_connection where tenant_id = $1 and provider = $2`, [tenantId, provider])
    );
    return result.rows[0] ? rowToConnection(result.rows[0]) : null;
  }
}

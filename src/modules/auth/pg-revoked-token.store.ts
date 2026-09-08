import { Pool } from "pg";
import { RevokedRefreshTokenStore } from "./auth.service";
import { runWithTenantContext } from "../../common/postgres";

/**
 * Real Postgres-backed RevokedRefreshTokenStore, against the
 * `revoked_refresh_token` table from 0004_refresh_token_revocation.sql. Same
 * tenant-context-per-transaction pattern as every other Pg*Store — see
 * src/common/postgres.ts.
 *
 * ACTUALLY RUN against a real local PostgreSQL 17 instance — see
 * pg-revoked-token.store.test.ts (gated behind TEST_DATABASE_URL).
 *
 * KNOWN GAP, inherited from the migration itself: nothing here deletes a row
 * once its expires_at has passed, so this table grows forever at real
 * volume. A scheduled `delete from revoked_refresh_token where expires_at <
 * now()` job is still needed before production — not attempted here, since
 * this scaffold has no background-job runtime (Redis/BullMQ, Master Plan
 * Section 4) to run one on yet.
 */
export class PgRevokedRefreshTokenStore implements RevokedRefreshTokenStore {
  constructor(private readonly pool: Pool) {}

  async isRevoked(tenantId: string, jti: string): Promise<boolean> {
    const result = await runWithTenantContext(this.pool, tenantId, (client) =>
      client.query(`select 1 from revoked_refresh_token where jti = $1`, [jti])
    );
    return (result.rowCount ?? 0) > 0;
  }

  async revoke(tenantId: string, userId: string, jti: string, expiresAt: Date): Promise<void> {
    await runWithTenantContext(this.pool, tenantId, (client) =>
      client.query(
        `insert into revoked_refresh_token (jti, tenant_id, user_id, expires_at)
         values ($1, $2, $3, $4)
         on conflict (jti) do nothing`,
        [jti, tenantId, userId, expiresAt]
      )
    );
  }
}

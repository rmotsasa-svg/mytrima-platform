import { Pool } from "pg";
import { AdminRevokedRefreshTokenStore } from "./admin-auth.service";

/** Real Postgres-backed AdminRevokedRefreshTokenStore, against
 * `admin_revoked_refresh_token` (db/migrations/0049). No tenant context
 * to scope to — see that interface's own comment. */
export class PgAdminRevokedRefreshTokenStore implements AdminRevokedRefreshTokenStore {
  constructor(private readonly pool: Pool) {}

  async isRevoked(jti: string): Promise<boolean> {
    const result = await this.pool.query(`select 1 from admin_revoked_refresh_token where jti = $1`, [jti]);
    return (result.rowCount ?? 0) > 0;
  }

  async revoke(adminUserId: string, jti: string, expiresAt: Date): Promise<void> {
    await this.pool.query(
      `insert into admin_revoked_refresh_token (jti, admin_user_id, expires_at)
       values ($1, $2, $3)
       on conflict (jti) do nothing`,
      [jti, adminUserId, expiresAt]
    );
  }
}

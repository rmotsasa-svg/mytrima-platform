import { Injectable } from "@nestjs/common";
import { RevokedRefreshTokenStore } from "./auth.service";

/**
 * KNOWN GAP: in-memory only, same caveat as the other in-memory stores —
 * replaced with a Postgres-backed table (PgRevokedRefreshTokenStore, against
 * db/migrations/0004_refresh_token_revocation.sql) once a live database
 * exists; AuthModule already switches to it under DATABASE_URL. tenantId and
 * expiresAt are accepted (to match the real store's signature) but unused
 * here — a Map keyed purely by jti is already globally unique, unlike a real
 * RLS-scoped table. Also: this Map grows for as long as the process runs,
 * since nothing ever removes an entry once a token's natural 30-day expiry
 * passes it doesn't need tracking anymore. A real implementation needs a
 * periodic cleanup job (or a DB row with its own expires_at + a scheduled
 * DELETE) — not a concern at pilot scale, but flagged rather than silently
 * left for someone to discover as a slow leak.
 */
@Injectable()
export class InMemoryRevokedRefreshTokenStore implements RevokedRefreshTokenStore {
  private revokedJtis = new Set<string>();

  async isRevoked(_tenantId: string, jti: string): Promise<boolean> {
    return this.revokedJtis.has(jti);
  }

  async revoke(_tenantId: string, _userId: string, jti: string, _expiresAt: Date): Promise<void> {
    this.revokedJtis.add(jti);
  }
}

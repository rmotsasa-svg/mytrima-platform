import { Injectable } from "@nestjs/common";
import { AdminRevokedRefreshTokenStore } from "./admin-auth.service";

/** Same "in-memory only, grows for the process lifetime" caveat as
 * InMemoryRevokedRefreshTokenStore's own comment — a real cleanup job is
 * a future concern, not a pilot-scale one. */
@Injectable()
export class InMemoryAdminRevokedRefreshTokenStore implements AdminRevokedRefreshTokenStore {
  private revokedJtis = new Set<string>();

  async isRevoked(jti: string): Promise<boolean> {
    return this.revokedJtis.has(jti);
  }

  async revoke(_adminUserId: string, jti: string, _expiresAt: Date): Promise<void> {
    this.revokedJtis.add(jti);
  }
}

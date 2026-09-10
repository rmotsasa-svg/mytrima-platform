import { Inject, Injectable } from "@nestjs/common";
import { SOCIAL_CONNECTION_STORE } from "./social-publishing.tokens";

/**
 * A tenant's connected Facebook Page — the real Page access token obtained
 * through MetaOAuthService's actual OAuth exchange, not a manually-pasted
 * one (see meta.service.ts's own comment on why a Graph API Explorer token
 * doesn't satisfy Meta's App Review requirement that the login flow happen
 * "on your app platform").
 */
export interface SocialConnection {
  id: string;
  tenantId: string;
  provider: "facebook";
  pageId: string;
  pageName: string;
  pageAccessToken: string;
  /** The Facebook Page's linked Instagram professional account id, resolved
   * during the OAuth callback via `resolveInstagramAccount()` — `null` when
   * the Page has no Instagram account linked, which is the real, common
   * case, not an error (see meta.service.ts's own comment). Instagram
   * publishing uses this same Page access token, not a separate credential. */
  instagramAccountId: string | null;
  connectedAt: Date;
}

export class SocialConnectionNotFoundError extends Error {
  constructor(tenantId: string) {
    super(`No Facebook Page connected for tenant "${tenantId}" — connect one first via GET /social/:tenantId/connect`);
    this.name = "SocialConnectionNotFoundError";
  }
}

/** Thrown when an Instagram-posting endpoint is called for a tenant whose
 * connected Facebook Page has no linked Instagram professional account —
 * a real, expected state (see meta.service.ts's own comment), distinct
 * from SocialConnectionNotFoundError (no Facebook connection at all). */
export class NoInstagramAccountLinkedError extends Error {
  constructor(tenantId: string) {
    super(
      `Tenant "${tenantId}"'s connected Facebook Page has no linked Instagram professional account — link one in Facebook's own Page settings, then reconnect via GET /social/:tenantId/connect`
    );
    this.name = "NoInstagramAccountLinkedError";
  }
}

export interface SocialConnectionStore {
  save(connection: SocialConnection): Promise<void>;
  findByTenant(tenantId: string, provider: "facebook"): Promise<SocialConnection | null>;
}

@Injectable()
export class SocialConnectionService {
  constructor(@Inject(SOCIAL_CONNECTION_STORE) private readonly store: SocialConnectionStore) {}

  async save(connection: SocialConnection): Promise<void> {
    await this.store.save(connection);
  }

  async getForTenant(tenantId: string): Promise<SocialConnection | null> {
    return this.store.findByTenant(tenantId, "facebook");
  }

  /** Throws rather than returning null — every posting/editing/deleting
   * endpoint needs a real connection to act through; a missing one is a
   * clear, actionable error for the caller, not a silent no-op. */
  async requireForTenant(tenantId: string): Promise<SocialConnection> {
    const connection = await this.getForTenant(tenantId);
    if (!connection) throw new SocialConnectionNotFoundError(tenantId);
    return connection;
  }
}

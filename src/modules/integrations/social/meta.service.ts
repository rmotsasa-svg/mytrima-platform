import { PendingVerificationError } from "../pending-integration";

/**
 * Master Plan Section 8 status: Needs verification.
 * Confirmed: Facebook and Instagram both run on the Meta Graph API. Free of
 * per-call charges. Requires the business to convert to a Business/Creator
 * account and link a Facebook Page — personal profiles cannot be connected
 * at all. Standard Access (own accounts) is automatic; serving tenant
 * accounts requires Advanced Access.
 * NOT confirmed: Advanced Access requires Meta App Review (2–4 weeks per
 * submission, screencast required) and prior Business Verification — this
 * has not been started. Exact rate-limit ceiling depends on each tenant's
 * own impression volume (a Business Use Case formula), not a fixed number.
 */
export interface MetaSocialService {
  publishPost(tenantPageId: string, message: string, imageUrl?: string): Promise<{ postId: string }>;
  fetchEngagementSummary(tenantPageId: string): Promise<{ likes: number; comments: number; shares: number }>;
}

export class NotYetVerifiedMetaSocialService implements MetaSocialService {
  async publishPost(): Promise<{ postId: string }> {
    throw new PendingVerificationError(
      "Facebook & Instagram (Meta Graph API)",
      "Needs verification",
      "Advanced Access requires Meta App Review + Business Verification, not yet started"
    );
  }

  async fetchEngagementSummary(): Promise<{ likes: number; comments: number; shares: number }> {
    throw new PendingVerificationError(
      "Facebook & Instagram (Meta Graph API)",
      "Needs verification",
      "Advanced Access requires Meta App Review + Business Verification, not yet started"
    );
  }
}

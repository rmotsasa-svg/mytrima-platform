import { Inject, Injectable } from "@nestjs/common";
import { RATING_STORE } from "./reputation.tokens";

/**
 * Master Plan v1.2, Section 8 status: Verified (build decision) — replaces
 * the earlier Hellopeter integration entirely. Hellopeter's API was confirmed
 * to exist (see the removed src/modules/integrations/reputation/hellopeter.service.ts
 * history), but the commercial terms for a platform integrating on behalf of
 * many tenants — rather than a single business managing its own reviews —
 * were never resolved, and staying blocked on that negotiation was a real
 * risk to the pilot timeline. Building this in-house removes the vendor
 * dependency rather than leaving it as a permanent "needs verification" line.
 *
 * Google Business Profile (src/modules/integrations/reputation/google-business.service.ts)
 * stays in scope separately — it surfaces a tenant's existing public Google
 * reputation, which this module cannot substitute for.
 */

export type RatingStatus = "pending" | "public" | "hidden";

export interface Rating {
  id: string;
  tenantId: string;
  customerId: string;
  stars: number; // 1-5
  comment?: string;
  status: RatingStatus;
  submittedAt: Date;
  moderatedAt?: Date;
}

export class InvalidRatingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidRatingError";
  }
}

export interface RatingStore {
  save(rating: Rating): Promise<void>;
  /**
   * Takes tenantId, not just an id — same reasoning as ConsentStore.revoke():
   * found while building the Postgres-backed store, an id-only signature has
   * no tenant to scope app.current_tenant_id to, so a real RLS-enforced
   * UPDATE would silently affect zero rows without one.
   */
  updateStatus(tenantId: string, id: string, status: RatingStatus, moderatedAt: Date): Promise<void>;
  findAllForTenant(tenantId: string): Promise<Rating[]>;
  /**
   * Added to close a real gap flagged since RatingController's moderate
   * endpoint was first written: producing a `notificationsForModeratedRating`
   * event (automation.service.ts) needs the rating's own customerId and
   * stars, which the moderate HTTP request never carries — only the id and
   * the target status. Same tenantId-scoping reasoning as updateStatus()
   * above: an id-only lookup would leak a different tenant's row.
   */
  findById(tenantId: string, id: string): Promise<Rating | null>;
}

function validateStars(stars: number): void {
  if (!Number.isInteger(stars) || stars < 1 || stars > 5) {
    throw new InvalidRatingError(`Rating stars must be an integer 1–5, got ${stars}`);
  }
}

@Injectable()
export class RatingService {
  constructor(@Inject(RATING_STORE) private readonly store: RatingStore) {}

  /**
   * Every submitted rating starts 'pending' (Master Plan Section 7) — it does
   * not count toward a tenant's public aggregate until moderated.
   */
  async submit(tenantId: string, customerId: string, stars: number, id: string, comment?: string): Promise<Rating> {
    validateStars(stars);
    const rating: Rating = { id, tenantId, customerId, stars, comment, status: "pending", submittedAt: new Date() };
    await this.store.save(rating);
    return rating;
  }

  /**
   * Moderation is a one-way gate out of 'pending' into 'public' or 'hidden' —
   * not back into 'pending', which has no defined meaning for an already-
   * reviewed rating. Confirming this moderation workflow is wired into the
   * dashboard before ratings go live is the one thing Master Plan Section 9
   * calls out as still needed for this module.
   *
   * Returns the updated Rating (not void) so a caller — RatingController, to
   * fire notificationsForModeratedRating — has the customerId/stars it needs
   * without a second round trip. Returns null for a wrong-tenant or unknown
   * id, exactly mirroring updateStatus()'s existing silent-no-op behavior
   * for that case (see the cross-tenant regression test below) rather than
   * throwing — a caller from the wrong tenant gets no information about
   * whether the id even exists.
   */
  async moderate(tenantId: string, id: string, status: "public" | "hidden"): Promise<Rating | null> {
    if (status !== "public" && status !== "hidden") {
      throw new InvalidRatingError(`Invalid moderation target status: ${status}`);
    }
    await this.store.updateStatus(tenantId, id, status, new Date());
    return this.store.findById(tenantId, id);
  }

  /**
   * Only 'public' ratings count toward the tenant's aggregate — a pending or
   * hidden rating must not silently move the number a tenant sees.
   */
  async aggregateForTenant(tenantId: string): Promise<{ averageStars: number; count: number }> {
    const all = await this.store.findAllForTenant(tenantId);
    const publicRatings = all.filter((r) => r.status === "public");
    if (publicRatings.length === 0) return { averageStars: 0, count: 0 };
    const sum = publicRatings.reduce((s, r) => s + r.stars, 0);
    return { averageStars: Math.round((sum / publicRatings.length) * 100) / 100, count: publicRatings.length };
  }

  /** Every rating for a tenant, any status — unlike aggregateForTenant()
   * (public only), a consumer building a per-customer activity view (see
   * CustomerService.getActivity()) needs pending/hidden ratings too, since
   * those are still real things that happened, just not yet public. */
  async findAllForTenant(tenantId: string): Promise<Rating[]> {
    return this.store.findAllForTenant(tenantId);
  }
}

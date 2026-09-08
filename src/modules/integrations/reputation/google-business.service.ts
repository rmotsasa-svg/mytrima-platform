import { PendingVerificationError } from "../pending-integration";

/**
 * Master Plan Section 8 status: UPGRADED from "Needs verification" — the
 * account-level Business Profile access request has been submitted AND
 * approved by Google (confirmed directly, not assumed). Quota/rate limits
 * and field coverage, the two things this status previously flagged as
 * unconfirmed, are now both confirmed from Google's own docs:
 *   - Quota: 300 requests/minute default once Basic API Access is approved
 *     (0 req/min before approval); 10 edits/minute per location specifically
 *     for the Business Information API. Quota increases require hitting
 *     >50% average utilization first — not automatic.
 *   - Field coverage: reviewId, reviewer (displayName/profilePhotoUrl/
 *     isAnonymous), starRating, comment, createTime, updateTime, and any
 *     business reply are all present on the Review resource.
 *
 * NOT the same shape as this file's old generic interface — deliberately
 * removed, not implemented, for the same reason MoPay's client doesn't
 * implement its old generic payment interface: forcing a real API into a
 * guessed shape misrepresents it. See GoogleBusinessProfileService below.
 *
 * IMPORTANT ARCHITECTURAL FINDING, confirmed from Google's own OAuth docs
 * AND by actually running the consent flow live: this API has NO API-key or
 * service-account auth path at all. Every request requires an OAuth 2.0
 * access token obtained through actual user consent (scope
 * `https://www.googleapis.com/auth/business.manage`) from the Google
 * account that manages the business listing — meaning EACH TENANT must
 * individually go through a "Connect your Google Business Profile" consent
 * flow; there is no single platform-wide credential that reads every
 * tenant's reviews. A real OAuth Client ID was created, the consent screen
 * was actually completed end-to-end via OAuth Playground, and the resulting
 * access token successfully called the real
 * `mybusinessaccountmanagement`/`mybusinessbusinessinformation` APIs — real
 * account (`accounts/104266002252742392926`) and a real, named location
 * (`locations/9390455988328226242`, "Visual Creation Lesotho") were both
 * returned live. So the OAuth/account/location plumbing this client depends
 * on is genuinely proven, not assumed.
 *
 * A SECOND, SEPARATE ACCESS GATE — found only by actually trying the live
 * call, not documented anywhere obvious: the Reviews endpoint lives on the
 * older `mybusiness.googleapis.com` (legacy v4) API, which requires its OWN
 * "Basic API Access" approval, distinct from the Business Profile access
 * already granted. Confirmed via a real 403 SERVICE_DISABLED response, then
 * via Google's own support docs: apply at
 * support.google.com/business/contact/api_default (select "Application for
 * Basic API Access", provide the GCP Project Number). Eligibility per
 * Google's own stated requirements: the Business Profile must be **verified
 * and active for 60+ days**, and must have **a website listed on the
 * profile**. The real test location found above came back with
 * `verificationState: "UNVERIFIED"` on its parent account — if that holds
 * for the location itself, this specific approval will likely be rejected
 * until the listing is verified, which is itself a real prerequisite worth
 * knowing before submitting the form and waiting days-to-weeks for nothing.
 *
 * NOT YET verified live: the actual fetchReviews() call, blocked on the
 * second access gate above. Tested against a mocked `fetch` only (see
 * google-business.service.test.ts) — re-verify against a real access token
 * once Basic API Access for `mybusiness.googleapis.com` is approved.
 */

export class GoogleBusinessApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GoogleBusinessApiError";
  }
}

// Confirmed from the Review resource schema: starRating is an enum string
// (ONE..FIVE), not a number — easy to get wrong without checking the actual
// schema instead of assuming a numeric field.
type GoogleStarRatingEnum = "ONE" | "TWO" | "THREE" | "FOUR" | "FIVE" | "STAR_RATING_UNSPECIFIED";

const STAR_RATING_TO_NUMBER: Readonly<Record<GoogleStarRatingEnum, number>> = {
  ONE: 1,
  TWO: 2,
  THREE: 3,
  FOUR: 4,
  FIVE: 5,
  STAR_RATING_UNSPECIFIED: 0,
};

export interface GoogleReviewer {
  displayName?: string;
  profilePhotoUrl?: string;
  isAnonymous?: boolean;
}

export interface GoogleReview {
  /** Format: "accounts/{accountId}/locations/{locationId}/reviews/{reviewId}" */
  name: string;
  reviewId: string;
  reviewer?: GoogleReviewer;
  /** Normalized to 1-5 (0 if Google returns STAR_RATING_UNSPECIFIED) from the
   * raw ONE..FIVE enum — callers shouldn't have to know about that enum. */
  starRating: number;
  comment?: string;
  createTime: string;
  updateTime: string;
  replyComment?: string;
}

const DEFAULT_BASE_URL = "https://mybusiness.googleapis.com/v4";

/**
 * Thin client for the confirmed, documented Business Profile Reviews
 * endpoint. Takes a caller-supplied OAuth access token per call rather than
 * managing the OAuth dance itself — token acquisition/refresh is a
 * per-tenant concern (see the class comment above) that belongs in the
 * eventual "Connect Google Business Profile" flow, not in this thin client.
 */
export class GoogleBusinessProfileService {
  constructor(private readonly baseUrl: string = DEFAULT_BASE_URL) {}

  async fetchReviews(accessToken: string, accountId: string, locationId: string): Promise<GoogleReview[]> {
    const res = await fetch(
      `${this.baseUrl}/accounts/${encodeURIComponent(accountId)}/locations/${encodeURIComponent(locationId)}/reviews`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    const data = await res.json();

    if (!res.ok) {
      throw new GoogleBusinessApiError(data.error?.message ?? `Google Business Profile API returned an error (HTTP ${res.status})`);
    }

    const rawReviews: Array<Record<string, unknown>> = data.reviews ?? [];
    return rawReviews.map((r) => ({
      name: r.name as string,
      reviewId: r.reviewId as string,
      reviewer: r.reviewer as GoogleReviewer | undefined,
      starRating: STAR_RATING_TO_NUMBER[r.starRating as GoogleStarRatingEnum] ?? 0,
      comment: r.comment as string | undefined,
      createTime: r.createTime as string,
      updateTime: r.updateTime as string,
      replyComment: (r.reviewReply as { comment?: string } | undefined)?.comment,
    }));
  }
}

/** Retained only as documentation of the pre-upgrade shape; nothing in this
 * module implements it anymore — see the class comment above for why. */
export interface GoogleBusinessService {
  fetchReviews(locationId: string): Promise<Array<{ id: string; rating: number; comment: string }>>;
}

/** Kept only for any existing caller still importing this name. New code
 * should use GoogleBusinessProfileService directly. */
export class NotYetVerifiedGoogleBusinessService implements GoogleBusinessService {
  async fetchReviews(): Promise<Array<{ id: string; rating: number; comment: string }>> {
    throw new PendingVerificationError(
      "Google Business Profile API",
      "Needs verification",
      "superseded by GoogleBusinessProfileService — this class is a stub retained only for backward compatibility"
    );
  }
}

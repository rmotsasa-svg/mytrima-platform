import { Inject, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { META_APP_ID, META_APP_SECRET } from "./social-publishing.tokens";
import { MetaApiError, MetaGraphSocialService } from "../integrations/social/meta.service";
import { SocialConnection } from "./social-connection.service";

/**
 * The real Facebook Login OAuth exchange — built specifically because Meta
 * App Review requires the login/permission-grant flow to happen "on your
 * app platform," not on Graph API Explorer (Meta's own testing tool). This
 * is what makes that true: a real `dialog/oauth` redirect, a real
 * authorization-code exchange, and a real lookup of the Page (+ its own
 * Page access token) the user granted access to — the exact steps done by
 * hand via curl earlier in this project's own verification pass, now real
 * application code.
 *
 * Checked directly against Meta's current OAuth docs (developers.facebook.com,
 * Graph API v26.0) — the dialog/oauth and oauth/access_token endpoints, and
 * /me/accounts for resolving the authorized user's own Pages.
 *
 * LIVE-VERIFIED end-to-end on 10 Sep 2026, through this app's own running
 * server (not Graph API Explorer) — the exact flow Meta App Review's
 * screencast requirement demands:
 *   1. GET /social/:tenantId/connect  → real redirect to
 *      facebook.com/v26.0/dialog/oauth, user clicked "Continue" for real.
 *   2. Facebook redirected to /social/callback?code=...&state=<tenantId>;
 *      handleCallback() exchanged the code, resolved the real Page
 *      ("Mytrima", id 1345040488689239) via /me/accounts, and the resulting
 *      SocialConnection was saved to the real social_connection table.
 *   3. GET /social/:tenantId/connection confirmed {"connected":true,
 *      "pageId":"1345040488689239","pageName":"Mytrima",...} — proving the
 *      saved connection round-trips correctly and the page access token is
 *      never included in the response.
 *   4. Using that saved connection (no manually pasted token anywhere),
 *      POST/PATCH/DELETE /social/:tenantId/posts[/:postId] created, edited,
 *      and deleted a real post (1345040488689239_122095429095479138), with
 *      the post-delete engagement check confirming Facebook itself reports
 *      the object gone — proving MetaGraphSocialService is being driven
 *      entirely by tokens this OAuth flow produced, with no shortcut back to
 *      a hand-obtained Explorer token anywhere in the path.
 */

const GRAPH_API_VERSION = "v26.0";
const OAUTH_DIALOG_URL = "https://www.facebook.com/v26.0/dialog/oauth";
const GRAPH_API_BASE_URL = `https://graph.facebook.com/${GRAPH_API_VERSION}`;

// The four Facebook permissions meta.service.ts's MetaGraphSocialService
// needs — see that file's own comment on why each one is required and how
// they had to be added to the app's "Manage everything on your Page" use
// case before any OAuth grant could include them at all — plus the two
// Instagram scopes added 2026-09-10 for resolveInstagramAccount() /
// publishInstagramPost(), and three more added the same day for the
// account-metrics methods (fetchPageInsights/fetchPageMessageThreadCount/
// fetchInstagramInsights) — see meta.service.ts's top comment for exactly
// which Graph API call each one unlocks, and for the same "may need a new
// App Dashboard use case, not just this list" caveat that applied to
// pages_manage_posts before it.
const REQUIRED_SCOPES = [
  "pages_show_list",
  "pages_manage_posts",
  "pages_read_engagement",
  "pages_read_user_content",
  "instagram_basic",
  "instagram_content_publish",
  "read_insights",
  "pages_messaging",
  "instagram_manage_insights",
];

export class NoFacebookPageFoundError extends Error {
  constructor() {
    super("This Facebook account doesn't manage any Pages — create a Facebook Page first, then reconnect");
    this.name = "NoFacebookPageFoundError";
  }
}

@Injectable()
export class MetaOAuthService {
  constructor(
    @Inject(META_APP_ID) private readonly appId: string,
    @Inject(META_APP_SECRET) private readonly appSecret: string
  ) {}

  /** `state` carries the tenantId through the redirect round-trip — Facebook
   * returns it unchanged to the callback, since nothing else about the
   * callback request identifies which tenant initiated it. */
  buildAuthorizationUrl(tenantId: string, redirectUri: string): string {
    const params = new URLSearchParams({
      client_id: this.appId,
      redirect_uri: redirectUri,
      state: tenantId,
      scope: REQUIRED_SCOPES.join(","),
    });
    return `${OAUTH_DIALOG_URL}?${params.toString()}`;
  }

  /**
   * Exchanges the authorization code for a real user access token, then
   * resolves the first Facebook Page that user manages (and that Page's own
   * dedicated access token) via /me/accounts — exactly the manual curl
   * sequence used to first prove this integration, now real code.
   */
  async handleCallback(tenantId: string, code: string, redirectUri: string): Promise<SocialConnection> {
    const tokenParams = new URLSearchParams({
      client_id: this.appId,
      client_secret: this.appSecret,
      redirect_uri: redirectUri,
      code,
    });
    const tokenRes = await fetch(`${GRAPH_API_BASE_URL}/oauth/access_token?${tokenParams.toString()}`);
    const tokenData = await tokenRes.json();
    if (tokenData.error) {
      throw new MetaApiError(`Meta OAuth error (${tokenData.error.type ?? "unknown"}): ${tokenData.error.message}`, tokenData.error.code);
    }
    const userAccessToken: string = tokenData.access_token;

    const accountsParams = new URLSearchParams({ fields: "id,name,access_token", access_token: userAccessToken });
    const accountsRes = await fetch(`${GRAPH_API_BASE_URL}/me/accounts?${accountsParams.toString()}`);
    const accountsData = await accountsRes.json();
    if (accountsData.error) {
      throw new MetaApiError(`Meta Graph API error (${accountsData.error.type ?? "unknown"}): ${accountsData.error.message}`, accountsData.error.code);
    }
    const pages: Array<{ id: string; name: string; access_token: string }> = accountsData.data ?? [];
    if (pages.length === 0) throw new NoFacebookPageFoundError();

    // First Page found — a tenant connecting their own single business Page
    // is the only scenario this covers today (Standard Access); choosing
    // among several is a real UI decision for later, not invented here.
    const page = pages[0];

    // Best-effort: a Page with no linked Instagram account is the common,
    // expected case (resolveInstagramAccount() returns null for it, not an
    // error) — but if the instagram_basic/instagram_content_publish scopes
    // themselves were silently dropped by Facebook's own consent screen
    // (the exact per-app "Use Case" gap this project already hit once for
    // pages_manage_posts — see meta.service.ts), this call could fail with
    // a permissions error instead. That failure shouldn't block saving the
    // Facebook connection itself, which is fully working regardless —
    // logged and left null rather than thrown, same tradeoff as any
    // genuinely optional enrichment step.
    let instagramAccountId: string | null = null;
    try {
      instagramAccountId = await new MetaGraphSocialService(page.access_token).resolveInstagramAccount(page.id);
    } catch (err) {
      console.warn(`Could not resolve an Instagram account for Page ${page.id}: ${(err as Error).message}`);
    }

    return {
      id: randomUUID(),
      tenantId,
      provider: "facebook",
      pageId: page.id,
      pageName: page.name,
      pageAccessToken: page.access_token,
      instagramAccountId,
      connectedAt: new Date(),
    };
  }
}

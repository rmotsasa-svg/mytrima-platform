/**
 * Master Plan Section 8 status: Facebook & Instagram (Meta Graph API) —
 * UPGRADED from a `PendingVerificationError` stub to a real client, same
 * pattern as MoPay's own upgrade. The actual Graph API mechanics below
 * (publishing to `/{page-id}/feed` or `/{page-id}/photos`, reading a post's
 * reactions/comments/shares) were checked directly against Meta's own
 * current documentation (developers.facebook.com, Graph API v26.0,
 * 2026-09-09) — not memory, and not assumed from an older API version.
 *
 * Standard Access — publishing to a Page *you* manage yourself — works
 * today with just a Page access token generated in Graph API Explorer, no
 * App Review needed. What Section 8 still marks "Needs verification" is
 * Advanced Access specifically: serving *other tenants'* Pages requires
 * Meta App Review (2–4 weeks, needs a screencast of this working) and
 * prior Business Verification, neither completed yet (see README). This
 * class works identically for both — the only difference is whose Page
 * access token you have and how it was obtained, not the API calls
 * themselves.
 *
 * REAL FINDING from reading the current docs, not assumed: modern Graph
 * API has no simple `likes` field on a Page post — Facebook consolidated
 * to multi-type `reactions` (Like, Love, Wow, ...) back in 2016, and the
 * current `/post` reference lists no `likes` field at all anymore.
 * `fetchEngagementSummary()`'s `likes` figure below is genuinely
 * `reactions.summary.total_count` — every reaction type combined, the
 * closest real equivalent and what most third-party tools mean by "likes"
 * for a Facebook post today, but not literally a thumbs-up-only count.
 * Documented here rather than silently treated as identical.
 *
 * Also changed from the original stub's signature: `fetchEngagementSummary`
 * now takes the `postId` `publishPost()` returns, not a Page id — engagement
 * is fundamentally a per-post concept in the Graph API (reactions/comments/
 * shares all live on the post object); there is no single documented call
 * for "a Page's aggregate engagement across all its posts" without the
 * separate Page Insights API and its own additional permissions, which
 * nothing here has asked for.
 *
 * ACTUALLY RUN against the live Graph API, not just written and assumed
 * correct: a real Page access token for the real "Mytrima" Facebook Page
 * was generated via Graph API Explorer and used to call this exact class's
 * publishPost() and fetchEngagementSummary() — publishPost() returned a
 * genuine post id (`{page-id}_{post-id}`), and fetchEngagementSummary()
 * correctly read back `{likes:0, comments:0, shares:0}` for that
 * freshly-created post. The test post was deleted immediately afterward via
 * the same Graph API (DELETE /{post-id}), confirmed `{"success":true}`.
 *
 * REAL FINDING from that live setup, not obvious from the docs alone:
 * `pages_manage_posts` and `pages_read_user_content` did not become
 * available no matter how carefully they were selected in Graph API
 * Explorer's permission picker — Explorer kept silently substituting
 * unrelated permissions (`pages_manage_ads`, `pages_messaging`) instead.
 * The actual cause: those two permissions simply were not yet part of the
 * app's own configuration — Meta's App Dashboard requires explicitly adding
 * the "Manage everything on your Page" use case (Dashboard → Use cases →
 * find it → Customize → add `pages_manage_posts` / `pages_read_user_content`
 * there) before Explorer can grant them at all, even for Standard Access to
 * your own Page. Checking "Requirements" against Meta's own permissions
 * reference confirmed the underlying model is right — "Meta App Review –
 * For apps that need access to data you do not own or manage" — so once
 * that one-time Dashboard configuration was done, Standard Access to the
 * app owner's own Page worked immediately, no review needed.
 *
 * INSTAGRAM ADDED 2026-09-10 — Master Plan §6's Social Publishing Service
 * was always "Facebook *and* Instagram," but only Facebook existed until
 * now. Checked directly against Meta's current Instagram Graph API content-
 * publishing docs (developers.facebook.com, 2026-09-10), not assumed from
 * the Facebook-side mechanics above:
 *   - Instagram publishing is a real Facebook Page's *linked* Instagram
 *     professional account, resolved via `GET /{page-id}?fields=
 *     instagram_business_account` using the same Page access token — there
 *     is no separate Instagram-only credential to obtain.
 *   - Publishing is a genuine two-step process, unlike a Facebook Page post:
 *     `POST /{ig-user-id}/media` creates a container (returns a
 *     `creation_id`, publishes nothing yet), then `POST /{ig-user-id}/
 *     media_publish` with that `creation_id` actually publishes it. There is
 *     no single-call equivalent to `/{page-id}/feed`.
 *   - Instagram has no text-only post — `image_url` is required, not
 *     optional like `publishPost`'s. `caption` is optional. Documented here
 *     as a real interface difference rather than forced into the same
 *     shape as `publishPost`.
 *   - Requires `instagram_basic` + `instagram_content_publish` (Facebook
 *     Login path) in addition to the four Facebook scopes already listed
 *     above — see `meta-oauth.service.ts`'s `REQUIRED_SCOPES`.
 *   - Rate limit per the docs: 100 API-published posts per rolling 24
 *     hours per Instagram account — not enforced client-side here, just
 *     documented, same as no client-side rate limiting exists for
 *     `publishPost` either.
 * NOT YET live-verified: doing so needs a real Instagram professional
 * account actually linked to the "Mytrima" Facebook Page, which does not
 * exist yet — same honest gap as Google Business Profile's second access
 * gate. `resolveInstagramAccount()` returning `null` for the real Page is
 * the live-checked proof of that gap, not a guess (see README).
 *
 * ACCOUNT METRICS ADDED 2026-09-10 — the tenant asked for the Business
 * Snapshot report to include the actual Meta numbers a business owner
 * thinks of as "how is my page doing": followers, likes, comments, shares,
 * impressions, views, and messages. Checked directly against Meta's
 * current docs (developers.facebook.com, Graph API v26.0, and the
 * Instagram Platform Graph API reference, both fetched 2026-09-10), not
 * memory — three real, non-obvious findings came out of that check rather
 * than being assumed:
 *
 *   1. `page_impressions_unique` and the entire `post_impressions*` family
 *      are marked deprecated above v25 in Meta's own current Page Insights
 *      reference, and Meta's docs note a further wave of Page Insights
 *      metrics scheduled for deprecation by 15 Jun 2026 — a date already in
 *      the past relative to when this was written. `page_impressions`
 *      (the base, non-unique metric) and `page_views_total` are NOT on
 *      either deprecated list as of this check, so those two are what
 *      `fetchPageInsights()` requests — not the unique variants, and not
 *      assumed still valid without checking.
 *   2. Instagram's `impressions` metric was deprecated for v22.0 and fully
 *      removed for ALL API versions on 21 Apr 2025 — meaning there is no
 *      way to request IG impressions at all on the API version this client
 *      targets, not a permission gap. `views` is Meta's own documented
 *      replacement (a unified "how many times your content was played or
 *      displayed" metric) and is the only one `fetchInstagramInsights()`
 *      requests — this client reports IG "impressions" as simply absent,
 *      never as zero or an error, since asking for a metric Meta has
 *      deleted would just be a 400 masquerading as a real "no data" result.
 *   3. The Conversation node (`GET /{page-id}/conversations`)'s own
 *      documented fields are `id`, `is_owner`, `messages`, `participants`,
 *      `updated_time` — no `message_count` or any other aggregate field
 *      exists on it, unlike `reactions`/`comments`'s `.summary(true)`
 *      trick used by `fetchEngagementSummary()` above. So
 *      `fetchPageMessageThreadCount()` counts CONVERSATION THREADS whose
 *      `updated_time` falls in the requested window, not individual
 *      messages — documented here as a real, deliberate interpretation of
 *      "messages," not a shortcut hidden from the caller.
 *
 * Three new scopes this requires — `read_insights` (Page Insights),
 * `instagram_manage_insights` (IG Insights), `pages_messaging`
 * (Conversations) — were added to `MetaOAuthService.REQUIRED_SCOPES`. Per
 * this file's own earlier finding about `pages_manage_posts`, a new scope
 * appearing in `REQUIRED_SCOPES` is necessary but may not be sufficient:
 * Meta's App Dashboard may require adding the matching "use case" before
 * the permission is actually grantable, exactly as happened before. Follower
 * count needs no new scope at all (`fetchPageFollowerCount`/
 * `fetchInstagramFollowerCount` are plain node fields under permissions
 * already granted).
 */

const GRAPH_API_VERSION = "v26.0";
const GRAPH_API_BASE_URL = `https://graph.facebook.com/${GRAPH_API_VERSION}`;

export interface MetaSocialService {
  publishPost(pageId: string, message: string, imageUrl?: string): Promise<{ postId: string }>;
  fetchEngagementSummary(postId: string): Promise<{ likes: number; comments: number; shares: number }>;
  /** Meta's own `pages_manage_posts` permission reference lists "Update a
   * post... on your Page" as allowed usage — POST to /{post-id} (not
   * /feed) with a new `message` edits it in place. */
  updatePost(postId: string, message: string): Promise<{ success: true }>;
  deletePost(postId: string): Promise<{ success: true }>;
  /** Returns the Instagram professional account id linked to this Facebook
   * Page, or `null` if none is linked — a real, expected outcome (see this
   * file's top comment), not an error condition. */
  resolveInstagramAccount(pageId: string): Promise<string | null>;
  /** Instagram has no text-only post — `imageUrl` is required, unlike
   * `publishPost`'s. Internally a two-step container-create-then-publish
   * call; see this file's top comment for why that can't collapse into one
   * request the way a Facebook Page post can. */
  publishInstagramPost(igUserId: string, imageUrl: string, caption?: string): Promise<{ postId: string }>;

  /** Simple Page-node field, not an Insights call — needs only
   * `pages_read_engagement`, already in `REQUIRED_SCOPES`. A point-in-time
   * count: Meta has no documented way to ask "how many followers did this
   * Page have on date X" via this field, so callers get today's number,
   * not a value scoped to any period — see this file's top comment on the
   * Business Snapshot section below for how that's disclosed. */
  fetchPageFollowerCount(pageId: string): Promise<number>;

  /** Page Insights, `period=day` summed across `since`..`until` — genuinely
   * period-scoped, unlike follower count. Needs the `read_insights`
   * permission (added to `REQUIRED_SCOPES` 2026-09-10 alongside this
   * method) — a Page-level metric, not per-post. */
  fetchPageInsights(pageId: string, since: Date, until: Date): Promise<{ impressions: number; views: number }>;

  /** Counts message *threads* whose `updated_time` falls in the window —
   * see this file's top comment for why this is a thread count, not an
   * individual-message count: the Conversation node's own documented
   * fields (`id`, `messages`, `participants`, `updated_time`) have no
   * message-count aggregate, and the `messages` edge would need per-thread
   * pagination to count individually. Needs `pages_messaging`. */
  fetchPageMessageThreadCount(pageId: string, since: Date, until: Date): Promise<number>;

  /** Same shape as `fetchPageFollowerCount` — a plain IG User node field,
   * needs only `instagram_basic`, already granted. */
  fetchInstagramFollowerCount(igUserId: string): Promise<number>;

  /** IG Insights. Deliberately requests `views` only, not `impressions` —
   * see this file's top comment: Meta deprecated `impressions` on the
   * Instagram Graph API (fully removed for all versions 21 Apr 2025);
   * `views` is the documented replacement and the only one requested here,
   * so there is no IG `impressions` figure to report, ever, on current API
   * versions — not a gap in this client. Needs `instagram_manage_insights`. */
  fetchInstagramInsights(igUserId: string, since: Date, until: Date): Promise<{ views: number; reach: number }>;
}

export class MetaApiError extends Error {
  constructor(
    message: string,
    public readonly code?: number
  ) {
    super(message);
    this.name = "MetaApiError";
  }
}

/**
 * Real client for the Meta Graph API. Takes a Page access token via
 * constructor, same pattern as `MoPayService`'s apiKey — trivially testable
 * with a fake token, no env read buried inside methods.
 *
 * Permissions required, per Meta's own documented requirements for these
 * two calls: `publishPost` needs `pages_manage_posts`, `pages_read_engagement`,
 * `pages_show_list`; `fetchEngagementSummary` needs `pages_read_engagement`,
 * `pages_read_user_content`. All Standard Access — automatic for a Page you
 * manage yourself once you generate its Page access token.
 */
export class MetaGraphSocialService implements MetaSocialService {
  constructor(private readonly pageAccessToken: string) {}

  /**
   * POST /{page-id}/feed requires "either link or message" per the docs —
   * always sending `message` satisfies that unconditionally. With an
   * `imageUrl`, posts to `/{page-id}/photos` instead (the image becomes the
   * photo, `message` becomes its caption) — `/feed`'s own `object_attachment`
   * field needs an id for a photo already uploaded to the Page's own photo
   * albums, not an arbitrary URL, so it doesn't fit what this interface's
   * `imageUrl` actually implies.
   */
  async publishPost(pageId: string, message: string, imageUrl?: string): Promise<{ postId: string }> {
    const endpoint = imageUrl
      ? `${GRAPH_API_BASE_URL}/${encodeURIComponent(pageId)}/photos`
      : `${GRAPH_API_BASE_URL}/${encodeURIComponent(pageId)}/feed`;
    const body = new URLSearchParams({ access_token: this.pageAccessToken });
    if (imageUrl) {
      body.set("url", imageUrl);
      body.set("caption", message);
    } else {
      body.set("message", message);
    }

    const res = await fetch(endpoint, { method: "POST", body });
    const data = await res.json();
    if (data.error) {
      throw new MetaApiError(`Meta Graph API error (${data.error.type ?? "unknown"}): ${data.error.message}`, data.error.code);
    }
    // /photos returns {id, post_id} where `id` is the photo's own id, not
    // the post's — post_id is what a caller actually wants. /feed returns
    // {id} directly, which already is the post id. Either way, this
    // normalizes to the real Page-post id.
    return { postId: data.post_id ?? data.id };
  }

  /** Takes the id publishPost() returned — see this file's own top comment
   * for why this isn't a Page-level aggregate, and why `likes` here means
   * total reactions of every type, not a thumbs-up-only count. */
  async fetchEngagementSummary(postId: string): Promise<{ likes: number; comments: number; shares: number }> {
    const params = new URLSearchParams({
      fields: "reactions.summary(true).limit(0),comments.summary(true).limit(0),shares",
      access_token: this.pageAccessToken,
    });
    const res = await fetch(`${GRAPH_API_BASE_URL}/${encodeURIComponent(postId)}?${params.toString()}`);
    const data = await res.json();
    if (data.error) {
      throw new MetaApiError(`Meta Graph API error (${data.error.type ?? "unknown"}): ${data.error.message}`, data.error.code);
    }
    return {
      likes: data.reactions?.summary?.total_count ?? 0,
      comments: data.comments?.summary?.total_count ?? 0,
      shares: data.shares?.count ?? 0,
    };
  }

  async updatePost(postId: string, message: string): Promise<{ success: true }> {
    const body = new URLSearchParams({ message, access_token: this.pageAccessToken });
    const res = await fetch(`${GRAPH_API_BASE_URL}/${encodeURIComponent(postId)}`, { method: "POST", body });
    const data = await res.json();
    if (data.error) {
      throw new MetaApiError(`Meta Graph API error (${data.error.type ?? "unknown"}): ${data.error.message}`, data.error.code);
    }
    return { success: true };
  }

  async deletePost(postId: string): Promise<{ success: true }> {
    const params = new URLSearchParams({ access_token: this.pageAccessToken });
    const res = await fetch(`${GRAPH_API_BASE_URL}/${encodeURIComponent(postId)}?${params.toString()}`, { method: "DELETE" });
    const data = await res.json();
    if (data.error) {
      throw new MetaApiError(`Meta Graph API error (${data.error.type ?? "unknown"}): ${data.error.message}`, data.error.code);
    }
    return { success: true };
  }

  async resolveInstagramAccount(pageId: string): Promise<string | null> {
    const params = new URLSearchParams({ fields: "instagram_business_account", access_token: this.pageAccessToken });
    const res = await fetch(`${GRAPH_API_BASE_URL}/${encodeURIComponent(pageId)}?${params.toString()}`);
    const data = await res.json();
    if (data.error) {
      throw new MetaApiError(`Meta Graph API error (${data.error.type ?? "unknown"}): ${data.error.message}`, data.error.code);
    }
    // Absent entirely (not an error) when the Page has no linked Instagram
    // professional account — the documented, expected shape of "not linked".
    return data.instagram_business_account?.id ?? null;
  }

  /** Container-create-then-publish, per Instagram's own documented content-
   * publishing flow — see this file's top comment for why this can't be one
   * call the way a Facebook Page post can. */
  async publishInstagramPost(igUserId: string, imageUrl: string, caption?: string): Promise<{ postId: string }> {
    const containerBody = new URLSearchParams({ image_url: imageUrl, access_token: this.pageAccessToken });
    if (caption) containerBody.set("caption", caption);
    const containerRes = await fetch(`${GRAPH_API_BASE_URL}/${encodeURIComponent(igUserId)}/media`, {
      method: "POST",
      body: containerBody,
    });
    const containerData = await containerRes.json();
    if (containerData.error) {
      throw new MetaApiError(
        `Meta Graph API error (${containerData.error.type ?? "unknown"}): ${containerData.error.message}`,
        containerData.error.code
      );
    }

    const publishBody = new URLSearchParams({ creation_id: containerData.id, access_token: this.pageAccessToken });
    const publishRes = await fetch(`${GRAPH_API_BASE_URL}/${encodeURIComponent(igUserId)}/media_publish`, {
      method: "POST",
      body: publishBody,
    });
    const publishData = await publishRes.json();
    if (publishData.error) {
      throw new MetaApiError(
        `Meta Graph API error (${publishData.error.type ?? "unknown"}): ${publishData.error.message}`,
        publishData.error.code
      );
    }
    return { postId: publishData.id };
  }

  async fetchPageFollowerCount(pageId: string): Promise<number> {
    const params = new URLSearchParams({ fields: "followers_count", access_token: this.pageAccessToken });
    const res = await fetch(`${GRAPH_API_BASE_URL}/${encodeURIComponent(pageId)}?${params.toString()}`);
    const data = await res.json();
    if (data.error) {
      throw new MetaApiError(`Meta Graph API error (${data.error.type ?? "unknown"}): ${data.error.message}`, data.error.code);
    }
    // Undocumented-but-observed: a brand-new Page can omit followers_count
    // entirely rather than returning 0 — treated the same way this file
    // already treats an omitted `shares` field on a post.
    return data.followers_count ?? 0;
  }

  /** Sums each day's value for the two requested metrics across
   * since..until — Insights returns one data point per day per metric for
   * `period=day`, not a single pre-aggregated total for the range. */
  async fetchPageInsights(pageId: string, since: Date, until: Date): Promise<{ impressions: number; views: number }> {
    const params = new URLSearchParams({
      metric: "page_impressions,page_views_total",
      period: "day",
      since: String(Math.floor(since.getTime() / 1000)),
      until: String(Math.floor(until.getTime() / 1000)),
      access_token: this.pageAccessToken,
    });
    const res = await fetch(`${GRAPH_API_BASE_URL}/${encodeURIComponent(pageId)}/insights?${params.toString()}`);
    const data = await res.json();
    if (data.error) {
      throw new MetaApiError(`Meta Graph API error (${data.error.type ?? "unknown"}): ${data.error.message}`, data.error.code);
    }
    const sumMetric = (metricName: string): number => {
      const metric = (data.data ?? []).find((m: { name: string }) => m.name === metricName);
      const values: Array<{ value: number }> = metric?.values ?? [];
      return values.reduce((sum, v) => sum + (v.value ?? 0), 0);
    };
    return { impressions: sumMetric("page_impressions"), views: sumMetric("page_views_total") };
  }

  /** See this file's top comment for why this counts conversation threads,
   * not individual messages: the Conversation node has no documented
   * message-count field. Paginates the real `/conversations` edge (100 per
   * page, Meta's own default-adjacent page size) rather than assuming the
   * whole tenant history fits in one response. */
  async fetchPageMessageThreadCount(pageId: string, since: Date, until: Date): Promise<number> {
    let count = 0;
    let url: string | null =
      `${GRAPH_API_BASE_URL}/${encodeURIComponent(pageId)}/conversations?` +
      new URLSearchParams({ fields: "updated_time", limit: "100", access_token: this.pageAccessToken }).toString();

    while (url) {
      const res: Response = await fetch(url);
      const data = await res.json();
      if (data.error) {
        throw new MetaApiError(`Meta Graph API error (${data.error.type ?? "unknown"}): ${data.error.message}`, data.error.code);
      }
      for (const thread of data.data ?? []) {
        const updatedAt = new Date(thread.updated_time);
        if (updatedAt >= since && updatedAt <= until) count++;
      }
      url = data.paging?.next ?? null;
    }
    return count;
  }

  async fetchInstagramFollowerCount(igUserId: string): Promise<number> {
    const params = new URLSearchParams({ fields: "followers_count", access_token: this.pageAccessToken });
    const res = await fetch(`${GRAPH_API_BASE_URL}/${encodeURIComponent(igUserId)}?${params.toString()}`);
    const data = await res.json();
    if (data.error) {
      throw new MetaApiError(`Meta Graph API error (${data.error.type ?? "unknown"}): ${data.error.message}`, data.error.code);
    }
    return data.followers_count ?? 0;
  }

  /** See this file's top comment: `impressions` is fully removed from the
   * Instagram Graph API on every version as of 21 Apr 2025, so only
   * `views` and `reach` are requested here — there is no IG impressions
   * figure this client (or any current-version client) can ever return. */
  async fetchInstagramInsights(igUserId: string, since: Date, until: Date): Promise<{ views: number; reach: number }> {
    const params = new URLSearchParams({
      metric: "views,reach",
      period: "day",
      since: String(Math.floor(since.getTime() / 1000)),
      until: String(Math.floor(until.getTime() / 1000)),
      access_token: this.pageAccessToken,
    });
    const res = await fetch(`${GRAPH_API_BASE_URL}/${encodeURIComponent(igUserId)}/insights?${params.toString()}`);
    const data = await res.json();
    if (data.error) {
      throw new MetaApiError(`Meta Graph API error (${data.error.type ?? "unknown"}): ${data.error.message}`, data.error.code);
    }
    const sumMetric = (metricName: string): number => {
      const metric = (data.data ?? []).find((m: { name: string }) => m.name === metricName);
      const values: Array<{ value: number }> = metric?.values ?? [];
      return values.reduce((sum, v) => sum + (v.value ?? 0), 0);
    };
    return { views: sumMetric("views"), reach: sumMetric("reach") };
  }
}

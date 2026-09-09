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
 */

const GRAPH_API_VERSION = "v26.0";
const GRAPH_API_BASE_URL = `https://graph.facebook.com/${GRAPH_API_VERSION}`;

export interface MetaSocialService {
  publishPost(pageId: string, message: string, imageUrl?: string): Promise<{ postId: string }>;
  fetchEngagementSummary(postId: string): Promise<{ likes: number; comments: number; shares: number }>;
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
}

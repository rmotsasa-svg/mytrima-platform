import { Injectable } from "@nestjs/common";
import { SocialConnectionService } from "./social-connection.service";
import { SocialPostLogService, SocialPostLogEntry } from "./social-post-log.service";
import { MetaGraphSocialService, MetaApiError } from "../integrations/social/meta.service";
import { Period } from "../../common/period";

/**
 * Aggregates the real Meta numbers a business owner actually thinks of as
 * "how is my page doing" — likes, comments, shares, followers, impressions,
 * views, messages — into the Business Snapshot report. Added 2026-09-10 at
 * the tenant's own request.
 *
 * Deliberately NOT one `MetaSocialService` call: likes/comments/shares are
 * summed from this tenant's own logged posts (SocialPostLogService) via the
 * already-live-verified `fetchEngagementSummary()`, one real Graph API call
 * per post — there is no Page-level aggregate for those the way there is
 * for impressions (see meta.service.ts's own top comment). Followers is a
 * point-in-time snapshot (Meta has no "followers on date X" field); the
 * rest (impressions, views, message threads) are genuinely period-scoped
 * via Page/IG Insights' own since/until.
 *
 * Every field can independently fail to be available — a missing scope
 * (read_insights/pages_messaging/instagram_manage_insights not yet granted
 * for a Page connected before 2026-09-10, or a Page Review-gated
 * permission never granted at all) shows up as `null` with a real reason
 * string in `unavailable`, never a silently fabricated 0. See README.md
 * for exactly which of these are live-verified today versus built and
 * unit-tested but pending a fresh OAuth consent with the three new scopes.
 */
export interface SocialMetricsResult {
  connected: boolean;
  pageName: string | null;
  facebook: {
    followers: number | null;
    impressions: number | null;
    views: number | null;
    messageThreads: number | null;
    likes: number;
    comments: number;
    shares: number;
    postsInPeriod: number;
  } | null;
  instagram: {
    connected: boolean;
    followers: number | null;
    views: number | null;
    likes: number;
    comments: number;
    shares: number;
    postsInPeriod: number;
  } | null;
  /** keyed by metric name (e.g. "facebook.impressions") -> human-readable
   * reason it's null, so a caller/report can say WHY, not just that it's
   * missing. */
  unavailable: Record<string, string>;
}

const EMPTY_ENGAGEMENT = { likes: 0, comments: 0, shares: 0, postsInPeriod: 0 };

@Injectable()
export class SocialMetricsService {
  constructor(
    private readonly connectionService: SocialConnectionService,
    private readonly postLogService: SocialPostLogService
  ) {}

  async getMetrics(tenantId: string, period: Period): Promise<SocialMetricsResult> {
    const connection = await this.connectionService.getForTenant(tenantId);
    if (!connection) {
      return { connected: false, pageName: null, facebook: null, instagram: null, unavailable: {} };
    }

    const client = new MetaGraphSocialService(connection.pageAccessToken);
    const unavailable: Record<string, string> = {};
    const allPosts = await this.postLogService.findRecentForTenant(tenantId, period.start);
    const postsInPeriod = allPosts.filter((p) => p.postedAt <= period.end);

    const [followers, insights, messageThreads, fbEngagement] = await Promise.all([
      this.safe(() => client.fetchPageFollowerCount(connection.pageId), unavailable, "facebook.followers"),
      this.safe(() => client.fetchPageInsights(connection.pageId, period.start, period.end), unavailable, "facebook.impressions/views"),
      this.safe(() => client.fetchPageMessageThreadCount(connection.pageId, period.start, period.end), unavailable, "facebook.messageThreads"),
      this.sumEngagement(
        client,
        postsInPeriod.filter((p) => p.provider === "facebook").map((p) => p.postId),
        unavailable,
        "facebook.engagement"
      ),
    ]);

    const facebook = {
      followers,
      impressions: insights?.impressions ?? null,
      views: insights?.views ?? null,
      messageThreads,
      ...(fbEngagement ?? EMPTY_ENGAGEMENT),
    };

    let instagram: SocialMetricsResult["instagram"] = null;
    if (connection.instagramAccountId) {
      const igId = connection.instagramAccountId;
      const [igFollowers, igInsights, igEngagement] = await Promise.all([
        this.safe(() => client.fetchInstagramFollowerCount(igId), unavailable, "instagram.followers"),
        this.safe(() => client.fetchInstagramInsights(igId, period.start, period.end), unavailable, "instagram.views"),
        this.sumEngagement(
          client,
          postsInPeriod.filter((p) => p.provider === "instagram").map((p) => p.postId),
          unavailable,
          "instagram.engagement"
        ),
      ]);
      instagram = {
        connected: true,
        followers: igFollowers,
        views: igInsights?.views ?? null,
        ...(igEngagement ?? EMPTY_ENGAGEMENT),
      };
    } else {
      instagram = { connected: false, followers: null, views: null, ...EMPTY_ENGAGEMENT };
    }

    return { connected: true, pageName: connection.pageName, facebook, instagram, unavailable };
  }

  /** One real Graph API call per logged post — no Page-level aggregate
   * exists for reactions/comments/shares (see meta.service.ts). A single
   * post's engagement fetch failing (e.g. the post was since deleted on
   * Facebook) doesn't take down the whole metric — it's skipped and noted,
   * same "partial, disclosed result over a silent zero or a hard failure"
   * discipline as everywhere else in this method. */
  private async sumEngagement(
    client: MetaGraphSocialService,
    postIds: string[],
    unavailable: Record<string, string>,
    key: string
  ): Promise<{ likes: number; comments: number; shares: number; postsInPeriod: number } | null> {
    if (postIds.length === 0) return { ...EMPTY_ENGAGEMENT };
    let likes = 0,
      comments = 0,
      shares = 0,
      counted = 0,
      failures = 0;
    for (const postId of postIds) {
      try {
        const summary = await client.fetchEngagementSummary(postId);
        likes += summary.likes;
        comments += summary.comments;
        shares += summary.shares;
        counted++;
      } catch (err) {
        failures++;
      }
    }
    if (failures > 0) {
      unavailable[key] = `${failures} of ${postIds.length} logged post(s) could not be read back from Meta (e.g. since deleted) — totals reflect the other ${counted}.`;
    }
    return { likes, comments, shares, postsInPeriod: counted };
  }

  private async safe<T>(fn: () => Promise<T>, unavailable: Record<string, string>, key: string): Promise<T | null> {
    try {
      return await fn();
    } catch (err) {
      unavailable[key] = err instanceof MetaApiError ? err.message : err instanceof Error ? err.message : "unknown error";
      return null;
    }
  }
}

import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Res, UseGuards } from "@nestjs/common";
import type { Response } from "express";
import { randomUUID } from "node:crypto";
import { MetaOAuthService } from "./meta-oauth.service";
import { NoInstagramAccountLinkedError, SocialConnectionService } from "./social-connection.service";
import { MetaGraphSocialService } from "../integrations/social/meta.service";
import { SocialPostLogService } from "./social-post-log.service";
import { RateLimit } from "../../common/rate-limit.decorator";
import { RateLimitGuard } from "../../common/rate-limit.guard";

interface CreatePostBody {
  message: string;
  imageUrl?: string;
}

interface UpdatePostBody {
  message: string;
}

interface CreateInstagramPostBody {
  imageUrl: string;
  caption?: string;
}

/**
 * The real "on your app platform" Facebook Login + posting flow Meta App
 * Review's screencast requirement needs — see meta-oauth.service.ts and
 * meta.service.ts's own comments for why a manually-pasted Graph API
 * Explorer token doesn't satisfy that requirement, but this does.
 *
 * REDIRECT_URI must exactly match a URI registered in the Meta App
 * Dashboard's "Valid OAuth Redirect URIs" (Facebook Login for Business
 * product settings) — Meta rejects the exchange otherwise. Read from
 * SOCIAL_REDIRECT_URI so this works against whatever host/port the app is
 * actually reachable at (localhost for this demo pass; a real public URL
 * once deployed), rather than a value hardcoded for one environment.
 */
@Controller("social")
export class SocialPublishingController {
  constructor(
    private readonly oauthService: MetaOAuthService,
    private readonly connectionService: SocialConnectionService,
    private readonly socialPostLogService: SocialPostLogService
  ) {}

  private redirectUri(): string {
    return process.env.SOCIAL_REDIRECT_URI ?? `http://localhost:${process.env.PORT ?? 3000}/social/callback`;
  }

  @Get(":tenantId/connect")
  connect(@Param("tenantId") tenantId: string, @Res() res: Response): void {
    res.redirect(this.oauthService.buildAuthorizationUrl(tenantId, this.redirectUri()));
  }

  /** Rate-limited (real gap found by deep review, fixed 2026-09-10):
   * unauthenticated by design — Facebook redirects the user's own browser
   * here, there is no access token to require — so anyone who finds this
   * URL could hammer it. 20 per minute per client IP. */
  @UseGuards(RateLimitGuard)
  @RateLimit({ max: 20, windowMs: 60 * 1000 })
  @Get("callback")
  async callback(@Query("code") code: string, @Query("state") tenantId: string, @Res() res: Response): Promise<void> {
    const connection = await this.oauthService.handleCallback(tenantId, code, this.redirectUri());
    await this.connectionService.save(connection);
    res.redirect(`/?connected=${encodeURIComponent(connection.pageName)}`);
  }

  @Get(":tenantId/connection")
  async getConnection(@Param("tenantId") tenantId: string) {
    const connection = await this.connectionService.getForTenant(tenantId);
    if (!connection) return { connected: false };
    // pageAccessToken deliberately never leaves this method — same
    // discipline as MoPayService.getSession() picking only safe fields off
    // its raw response, for the same reason (never let a real credential
    // leak into an HTTP response body).
    return {
      connected: true,
      pageId: connection.pageId,
      pageName: connection.pageName,
      instagramConnected: connection.instagramAccountId !== null,
      connectedAt: connection.connectedAt,
    };
  }

  @Post(":tenantId/posts")
  async createPost(@Param("tenantId") tenantId: string, @Body() body: CreatePostBody) {
    const connection = await this.connectionService.requireForTenant(tenantId);
    const service = new MetaGraphSocialService(connection.pageAccessToken);
    const result = await service.publishPost(connection.pageId, body.message, body.imageUrl);
    // Real gap found while designing the Growth Audit recommendation engine
    // (see migration 0017's own comment): nothing else records that this
    // tenant actually posted. Logged after a genuinely successful publish,
    // not before — a failed publish should never look like real activity.
    await this.socialPostLogService.record({ id: randomUUID(), tenantId, provider: "facebook", postId: result.postId, postedAt: new Date() });
    return result;
  }

  @Patch(":tenantId/posts/:postId")
  async updatePost(@Param("tenantId") tenantId: string, @Param("postId") postId: string, @Body() body: UpdatePostBody) {
    const connection = await this.connectionService.requireForTenant(tenantId);
    const service = new MetaGraphSocialService(connection.pageAccessToken);
    return service.updatePost(postId, body.message);
  }

  @Delete(":tenantId/posts/:postId")
  async deletePost(@Param("tenantId") tenantId: string, @Param("postId") postId: string) {
    const connection = await this.connectionService.requireForTenant(tenantId);
    const service = new MetaGraphSocialService(connection.pageAccessToken);
    return service.deletePost(postId);
  }

  @Get(":tenantId/posts/:postId/engagement")
  async getEngagement(@Param("tenantId") tenantId: string, @Param("postId") postId: string) {
    const connection = await this.connectionService.requireForTenant(tenantId);
    const service = new MetaGraphSocialService(connection.pageAccessToken);
    return service.fetchEngagementSummary(postId);
  }

  /** Instagram has no text-only post — imageUrl is required here, unlike
   * :tenantId/posts's optional one. See meta.service.ts's top comment for
   * why. Throws NoInstagramAccountLinkedError (mapped to 400) rather than
   * silently no-op-ing when the connected Page has no linked Instagram
   * account — a real, expected state this platform can't itself resolve
   * (the tenant has to link one in their own Facebook Page settings). */
  @Post(":tenantId/instagram-posts")
  async createInstagramPost(@Param("tenantId") tenantId: string, @Body() body: CreateInstagramPostBody) {
    const connection = await this.connectionService.requireForTenant(tenantId);
    if (!connection.instagramAccountId) throw new NoInstagramAccountLinkedError(tenantId);
    const service = new MetaGraphSocialService(connection.pageAccessToken);
    const result = await service.publishInstagramPost(connection.instagramAccountId, body.imageUrl, body.caption);
    await this.socialPostLogService.record({ id: randomUUID(), tenantId, provider: "instagram", postId: result.postId, postedAt: new Date() });
    return result;
  }
}

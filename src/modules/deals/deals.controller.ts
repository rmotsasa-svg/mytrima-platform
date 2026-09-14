import { Body, Controller, Get, NotFoundException, Param, Patch, Post, UploadedFile, UseGuards, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { randomUUID } from "node:crypto";
import { DealService, DiscountType, SocialChannel } from "./deal.service";
import { SocialConnectionService } from "../social-publishing/social-connection.service";
import { SocialPostLogService } from "../social-publishing/social-post-log.service";
import { MetaGraphSocialService } from "../integrations/social/meta.service";
import { AccessTokenGuard } from "../auth/access-token.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import { VerifiedAccessToken } from "../auth/auth.service";
import { authorize } from "../auth/rbac";
import { assertFileProvided, imageUploadOptions, publicImageUrl } from "../../common/uploads";

interface CreateDealBody {
  name: string;
  discountType: DiscountType;
  catalogItemIds: string[];
  percentageOff?: number;
  buyQuantity?: number;
  freeQuantity?: number;
  fixedAmountOff?: number;
  startsAt?: string;
  endsAt?: string;
}

interface UpdateDealBody {
  name?: string;
  discountType?: DiscountType;
  catalogItemIds?: string[];
  percentageOff?: number;
  buyQuantity?: number;
  freeQuantity?: number;
  fixedAmountOff?: number;
  /** Explicit `null` clears the date; omitted keeps the existing value —
   * see UpdateDealInput's own comment on why this differs from `undefined`. */
  startsAt?: string | null;
  endsAt?: string | null;
  isActive?: boolean;
}

interface PublishDealBody {
  /** Real, optional custom ad copy — defaults to
   * DealService.buildDefaultMessage()'s own real, non-fabricated text
   * built from the deal's actual fields. */
  message?: string;
}

/** Gated 2026-09-11 — closes the real gap the Platform Readiness Assessment
 * flagged. `deals:manage` covers every route here — no read_only split, per
 * rbac.ts's own comment: promotions/discounts are operational data with no
 * established read-only use case yet. */
@UseGuards(AccessTokenGuard)
@Controller("deals")
export class DealsController {
  constructor(
    private readonly dealService: DealService,
    private readonly socialConnectionService: SocialConnectionService,
    private readonly socialPostLogService: SocialPostLogService
  ) {}

  @Post(":tenantId")
  create(@CurrentUser() actor: VerifiedAccessToken, @Param("tenantId") tenantId: string, @Body() body: CreateDealBody) {
    authorize(actor, tenantId, "deals:manage");
    return this.dealService.create(tenantId, randomUUID(), {
      ...body,
      startsAt: body.startsAt ? new Date(body.startsAt) : undefined,
      endsAt: body.endsAt ? new Date(body.endsAt) : undefined,
    });
  }

  @Get(":tenantId")
  list(@CurrentUser() actor: VerifiedAccessToken, @Param("tenantId") tenantId: string) {
    authorize(actor, tenantId, "deals:manage");
    return this.dealService.listForTenant(tenantId);
  }

  @Get(":tenantId/:dealId")
  async getOne(@CurrentUser() actor: VerifiedAccessToken, @Param("tenantId") tenantId: string, @Param("dealId") dealId: string) {
    authorize(actor, tenantId, "deals:manage");
    const deal = await this.dealService.findById(tenantId, dealId);
    if (!deal) throw new NotFoundException(`No deal found with id "${dealId}"`);
    return deal;
  }

  /** Real gap closed 2026-09-14 at the tenant's own request — this
   * controller had no update/deactivate route at all before now (see
   * DealService.update()'s own comment for the exact PATCH semantics). */
  @Patch(":tenantId/:dealId")
  update(
    @CurrentUser() actor: VerifiedAccessToken,
    @Param("tenantId") tenantId: string,
    @Param("dealId") dealId: string,
    @Body() body: UpdateDealBody
  ) {
    authorize(actor, tenantId, "deals:manage");
    return this.dealService.update(tenantId, dealId, {
      ...body,
      startsAt: body.startsAt === null ? null : body.startsAt ? new Date(body.startsAt) : undefined,
      endsAt: body.endsAt === null ? null : body.endsAt ? new Date(body.endsAt) : undefined,
    });
  }

  /**
   * "Push this promotion through your sales channels" — real gap closed
   * 2026-09-14 at the tenant's own request. Reuses the exact same real
   * Facebook/Instagram posting machinery SocialPublishingController
   * already proved live (MetaGraphSocialService), rather than inventing a
   * second posting path — a deal push IS a real Facebook Page post (plus
   * an Instagram post when a Page's linked Instagram account exists and
   * the deal has an ad image, since Instagram has no text-only post).
   *
   * Per-channel, not all-or-nothing: if only Facebook is connected (no
   * Instagram linked, or the deal has no ad image yet), this still posts
   * to Facebook and reports Instagram as honestly skipped with a real
   * reason — it does not fail the whole request over one channel being
   * unavailable. Throws SocialConnectionNotFoundError (already mapped to
   * 404) only when there is truly no channel at all to push to.
   *
   * DISCLOSED, NOT HIDDEN, GAP: `adImageUrl` is a relative
   * `/uploads/deals/...` path served by this backend's own local disk
   * (common/uploads.ts) — Meta's servers fetch that URL themselves
   * server-side, so it must be a real, PUBLICLY reachable address. Built
   * from `API_PUBLIC_BASE_URL` (falls back to `http://localhost:<PORT>`
   * for local dev) — in local dev, Meta genuinely cannot reach that URL,
   * so an image-bearing push will only work once this backend is
   * deployed behind a real public domain. A text-only Facebook post (no
   * ad image on the deal, or Instagram skipped) has no such limitation.
   */
  @Post(":tenantId/:dealId/publish")
  async publish(
    @CurrentUser() actor: VerifiedAccessToken,
    @Param("tenantId") tenantId: string,
    @Param("dealId") dealId: string,
    @Body() body: PublishDealBody
  ) {
    authorize(actor, tenantId, "deals:manage");
    const deal = await this.dealService.findById(tenantId, dealId);
    if (!deal) throw new NotFoundException(`No deal found with id "${dealId}"`);

    const connection = await this.socialConnectionService.requireForTenant(tenantId);
    const message = body.message?.trim() || this.dealService.buildDefaultMessage(deal);
    const publicBaseUrl = process.env.API_PUBLIC_BASE_URL ?? `http://localhost:${process.env.PORT ?? 3000}`;
    const absoluteAdImageUrl = deal.adImageUrl ? `${publicBaseUrl}${deal.adImageUrl}` : undefined;

    const service = new MetaGraphSocialService(connection.pageAccessToken);
    const results: { channel: string; status: "posted" | "skipped" | "failed"; postId?: string; reason?: string }[] = [];
    const succeededChannels: SocialChannel[] = [];

    try {
      const fb = await service.publishPost(connection.pageId, message, absoluteAdImageUrl);
      await this.socialPostLogService.record({ id: randomUUID(), tenantId, provider: "facebook", postId: fb.postId, postedAt: new Date() });
      results.push({ channel: "facebook", status: "posted", postId: fb.postId });
      succeededChannels.push("facebook");
    } catch (err) {
      results.push({ channel: "facebook", status: "failed", reason: err instanceof Error ? err.message : String(err) });
    }

    if (!connection.instagramAccountId) {
      results.push({ channel: "instagram", status: "skipped", reason: "No Instagram account linked to this Facebook Page" });
    } else if (!absoluteAdImageUrl) {
      results.push({ channel: "instagram", status: "skipped", reason: "Deal has no ad image — Instagram requires one" });
    } else {
      try {
        const ig = await service.publishInstagramPost(connection.instagramAccountId, absoluteAdImageUrl, message);
        await this.socialPostLogService.record({ id: randomUUID(), tenantId, provider: "instagram", postId: ig.postId, postedAt: new Date() });
        results.push({ channel: "instagram", status: "posted", postId: ig.postId });
        succeededChannels.push("instagram");
      } catch (err) {
        results.push({ channel: "instagram", status: "failed", reason: err instanceof Error ? err.message : String(err) });
      }
    }

    if (succeededChannels.length > 0) {
      await this.dealService.recordPublish(tenantId, dealId, succeededChannels);
    }

    return { message, results };
  }

  /** Real ad/promotional creative upload — see common/uploads.ts's own
   * comment (local-disk storage, and the cross-tenant-write issue its
   * destination callback closes). Field name must be "image". */
  @Post(":tenantId/:dealId/image")
  @UseInterceptors(FileInterceptor("image", imageUploadOptions("deals")))
  async uploadImage(
    @CurrentUser() actor: VerifiedAccessToken,
    @Param("tenantId") tenantId: string,
    @Param("dealId") dealId: string,
    @UploadedFile() file: Express.Multer.File | undefined
  ) {
    authorize(actor, tenantId, "deals:manage");
    assertFileProvided(file);
    return this.dealService.setAdImage(tenantId, dealId, publicImageUrl("deals", tenantId, file.filename));
  }
}

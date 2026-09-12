import { Body, Controller, Get, NotFoundException, Param, Post, UploadedFile, UseGuards, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { randomUUID } from "node:crypto";
import { DealService, DiscountType } from "./deal.service";
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

/** Gated 2026-09-11 — closes the real gap the Platform Readiness Assessment
 * flagged. `deals:manage` covers every route here — no read_only split, per
 * rbac.ts's own comment: promotions/discounts are operational data with no
 * established read-only use case yet. */
@UseGuards(AccessTokenGuard)
@Controller("deals")
export class DealsController {
  constructor(private readonly dealService: DealService) {}

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

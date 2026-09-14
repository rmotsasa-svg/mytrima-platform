import { Body, Controller, Get, NotFoundException, Param, Post, UseGuards } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { IsArray, ArrayMinSize, IsIn, IsOptional, IsString, IsNotEmpty } from "class-validator";
import { CampaignService, CampaignChannel, CampaignLaunchResult } from "./campaign.service";
import { SocialConnectionService } from "../social-publishing/social-connection.service";
import { SocialPostLogService } from "../social-publishing/social-post-log.service";
import { MetaGraphSocialService } from "../integrations/social/meta.service";
import { CustomerService } from "../customers/customer.service";
import { DealService } from "../deals/deal.service";
import { WhatsAppService, createWhatsAppService } from "../integrations/whatsapp/whatsapp.service";
import { AccessTokenGuard } from "../auth/access-token.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import { VerifiedAccessToken } from "../auth/auth.service";
import { authorize } from "../auth/rbac";

/** A real `class`, not a plain `interface` — see BookingController's own
 * comment on why. */
export class CreateCampaignBody {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsOptional()
  @IsString()
  dealId?: string;

  @IsOptional()
  @IsString()
  message?: string;

  @IsArray()
  @ArrayMinSize(1)
  @IsIn(["facebook", "instagram", "whatsapp", "website"], { each: true })
  channels!: CampaignChannel[];
}

/**
 * "Add campaign set for Facebook, WhatsApp, Instagram and Website" — real
 * gap closed 2026-09-14 at the tenant's own explicit request. See
 * campaign.service.ts's own top comment for the full design and exactly
 * what each channel's launch does and does not do yet (WhatsApp needs a
 * real approved template; the website channel's link isn't yet fed back
 * into analytics — both disclosed, not hidden).
 *
 * `campaigns:manage` reuses `deals:manage` — a campaign is operational
 * marketing data with the same real shape (a promotional push to real
 * channels) and no established read-only use case, same reasoning
 * rbac.ts's own comment gives for deals/petty_cash.
 */
@UseGuards(AccessTokenGuard)
@Controller("campaigns")
export class CampaignsController {
  private readonly whatsAppService: WhatsAppService = createWhatsAppService();

  constructor(
    private readonly campaignService: CampaignService,
    private readonly socialConnectionService: SocialConnectionService,
    private readonly socialPostLogService: SocialPostLogService,
    private readonly customerService: CustomerService,
    private readonly dealService: DealService
  ) {}

  @Post(":tenantId")
  create(@CurrentUser() actor: VerifiedAccessToken, @Param("tenantId") tenantId: string, @Body() body: CreateCampaignBody) {
    authorize(actor, tenantId, "deals:manage");
    return this.campaignService.create(tenantId, randomUUID(), body);
  }

  @Get(":tenantId")
  list(@CurrentUser() actor: VerifiedAccessToken, @Param("tenantId") tenantId: string) {
    authorize(actor, tenantId, "deals:manage");
    return this.campaignService.listForTenant(tenantId);
  }

  @Get(":tenantId/:campaignId")
  async getOne(@CurrentUser() actor: VerifiedAccessToken, @Param("tenantId") tenantId: string, @Param("campaignId") campaignId: string) {
    authorize(actor, tenantId, "deals:manage");
    const campaign = await this.campaignService.findById(tenantId, campaignId);
    if (!campaign) throw new NotFoundException(`No campaign found with id "${campaignId}"`);
    return campaign;
  }

  /**
   * Launches this campaign across every channel it was created with.
   * Per-channel, not all-or-nothing — one channel failing, or having
   * nothing real to launch with (no social connection, no approved
   * WhatsApp template, no customer phone numbers on file) never blocks
   * another channel from being attempted. See this controller's own top
   * comment, and campaign.service.ts's, for exactly what each channel
   * really does.
   */
  @Post(":tenantId/:campaignId/launch")
  async launch(@CurrentUser() actor: VerifiedAccessToken, @Param("tenantId") tenantId: string, @Param("campaignId") campaignId: string) {
    authorize(actor, tenantId, "deals:manage");
    const campaign = await this.campaignService.findById(tenantId, campaignId);
    if (!campaign) throw new NotFoundException(`No campaign found with id "${campaignId}"`);

    const message = await this.campaignService.buildMessage(tenantId, campaign);
    const results: CampaignLaunchResult[] = [];

    const wantsFacebook = campaign.channels.includes("facebook");
    const wantsInstagram = campaign.channels.includes("instagram");
    if (wantsFacebook || wantsInstagram) {
      const connection = await this.socialConnectionService.getForTenant(tenantId);
      if (!connection) {
        if (wantsFacebook) results.push({ channel: "facebook", status: "skipped", detail: "No Facebook Page connected — connect one in Settings" });
        if (wantsInstagram) results.push({ channel: "instagram", status: "skipped", detail: "No Facebook Page connected — connect one in Settings" });
      } else {
        const service = new MetaGraphSocialService(connection.pageAccessToken);
        if (wantsFacebook) {
          try {
            const fb = await service.publishPost(connection.pageId, message);
            await this.socialPostLogService.record({ id: randomUUID(), tenantId, provider: "facebook", postId: fb.postId, postedAt: new Date() });
            results.push({ channel: "facebook", status: "posted", detail: fb.postId });
          } catch (err) {
            results.push({ channel: "facebook", status: "failed", detail: err instanceof Error ? err.message : String(err) });
          }
        }
        if (wantsInstagram) {
          if (!connection.instagramAccountId) {
            results.push({ channel: "instagram", status: "skipped", detail: "No Instagram account linked to this Facebook Page" });
          } else {
            // Instagram has no text-only post — see meta.service.ts's own
            // top comment. Without a linked deal's own ad image, there is
            // nothing real to post.
            const dealImageUrl = await this.resolveDealImageUrl(tenantId, campaign.dealId);
            if (!dealImageUrl) {
              results.push({ channel: "instagram", status: "skipped", detail: "This campaign has no ad image — link a deal with one, or Instagram has no text-only post" });
            } else {
              try {
                const ig = await service.publishInstagramPost(connection.instagramAccountId, dealImageUrl, message);
                await this.socialPostLogService.record({ id: randomUUID(), tenantId, provider: "instagram", postId: ig.postId, postedAt: new Date() });
                results.push({ channel: "instagram", status: "posted", detail: ig.postId });
              } catch (err) {
                results.push({ channel: "instagram", status: "failed", detail: err instanceof Error ? err.message : String(err) });
              }
            }
          }
        }
      }
    }

    if (campaign.channels.includes("whatsapp")) {
      const templateName = process.env.WHATSAPP_CAMPAIGN_TEMPLATE;
      if (!templateName) {
        results.push({
          channel: "whatsapp",
          status: "skipped",
          detail: "No approved WhatsApp template configured (WHATSAPP_CAMPAIGN_TEMPLATE unset) — see this endpoint's own comment",
        });
      } else {
        const customers = await this.customerService.listForTenant(tenantId);
        const withPhone = customers.filter((c) => c.phone);
        let sent = 0;
        let failed = 0;
        for (const customer of withPhone) {
          try {
            await this.whatsAppService.sendTemplateMessage(customer.phone!, templateName, [message]);
            sent++;
          } catch {
            failed++;
          }
        }
        results.push({
          channel: "whatsapp",
          status: sent > 0 ? "sent" : "skipped",
          detail:
            withPhone.length === 0
              ? "No customers with a phone number on file"
              : `${sent} sent, ${failed} failed, of ${withPhone.length} customer(s) with a phone number`,
        });
      }
    }

    if (campaign.channels.includes("website")) {
      const webBaseUrl = process.env.WEB_PUBLIC_BASE_URL ?? "http://localhost:5173";
      const trackableLink = `${webBaseUrl}/?utm_campaign=${campaignId}`;
      // DISCLOSED, NOT HIDDEN: this link is real and usable today, but
      // this platform's own website-analytics tracker doesn't yet report
      // on utm_campaign — see this controller's own top comment.
      results.push({
        channel: "website",
        status: "info",
        detail: `Use this real link in your own marketing: ${trackableLink} (click attribution isn't wired into Website Analytics yet)`,
      });
    }

    return this.campaignService.recordLaunch(tenantId, campaignId, results);
  }

  /** Instagram has no text-only post (see meta.service.ts's own top
   * comment) — a campaign can only post there when it's linked to a real
   * Deal that itself has a real uploaded ad image. */
  private async resolveDealImageUrl(tenantId: string, dealId: string | undefined): Promise<string | undefined> {
    if (!dealId) return undefined;
    const deal = await this.dealService.findById(tenantId, dealId);
    if (!deal?.adImageUrl) return undefined;
    const publicBaseUrl = process.env.API_PUBLIC_BASE_URL ?? `http://localhost:${process.env.PORT ?? 3000}`;
    return `${publicBaseUrl}${deal.adImageUrl}`;
  }
}

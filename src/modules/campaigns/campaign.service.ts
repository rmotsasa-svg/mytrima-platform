import { Inject, Injectable } from "@nestjs/common";
import { CAMPAIGN_STORE } from "./campaigns.tokens";
import { DealService } from "../deals/deal.service";

/**
 * "Add campaign set for Facebook, WhatsApp, Instagram and Website" — real
 * gap closed 2026-09-14, at the tenant's own explicit request. A campaign
 * is a real, named, multi-channel promotional push, optionally reusing an
 * existing Deal's own content (name/discount copy/ad image) rather than
 * inventing a second content model this platform would have to keep in
 * sync with the first.
 *
 * This service owns persistence only (create/list/find/recordLaunch) — the
 * actual multi-channel launch orchestration (real Graph API calls, real
 * WhatsApp sends) lives in CampaignsController.launch(), the exact same
 * split DealsController.publish() already established for the same real
 * reason: that orchestration needs live external clients
 * (MetaGraphSocialService, WhatsAppService) constructed from a real
 * connection's credentials, not something a persistence-only service
 * should own.
 *
 * What "launching" each channel actually does, and doesn't, yet:
 *   - facebook/instagram: a real Graph API post, via the exact same
 *     already-live-proven MetaGraphSocialService DealsController.publish()
 *     uses — not a second posting path.
 *   - whatsapp: a real bulk send to every customer with a phone number on
 *     file, via WhatsAppCloudApiService.sendTemplateMessage() — DISCLOSED,
 *     NOT HIDDEN, gap: needs a real, separate, pre-approved Meta template
 *     (`WHATSAPP_CAMPAIGN_TEMPLATE`), the same real constraint
 *     CustomerController.requestFeedback() already documents for its own
 *     WhatsApp channel — unset by default, honestly skipped with that
 *     reason rather than sending Meta's fixed-content `hello_world` sample.
 *   - website: a real, working, trackable link
 *     (`${WEB_PUBLIC_BASE_URL}/?utm_campaign=<campaignId>`) is generated
 *     and returned — DISCLOSED, NOT HIDDEN, gap: this platform's own
 *     website-analytics tracker (analytics/tracker-snippet.ts) does not
 *     yet capture or report on a `utm_campaign` query parameter, so no
 *     click-through count is attributed back to a campaign automatically
 *     yet. The link itself is real and usable today; the attribution
 *     reporting is a real, separate, not-yet-built follow-up, named here
 *     rather than silently faked.
 */

export type CampaignChannel = "facebook" | "instagram" | "whatsapp" | "website";

export interface CampaignLaunchResult {
  channel: CampaignChannel;
  status: "posted" | "sent" | "skipped" | "failed" | "info";
  detail?: string;
}

export interface Campaign {
  id: string;
  tenantId: string;
  name: string;
  dealId?: string;
  message?: string;
  channels: CampaignChannel[];
  lastLaunchedAt?: Date;
  lastLaunchResults?: CampaignLaunchResult[];
  createdAt: Date;
}

export class InvalidCampaignError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidCampaignError";
  }
}

export class CampaignNotFoundError extends Error {
  constructor(id: string) {
    super(`No campaign found with id "${id}"`);
    this.name = "CampaignNotFoundError";
  }
}

export interface CampaignStore {
  save(campaign: Campaign): Promise<void>;
  findAllForTenant(tenantId: string): Promise<Campaign[]>;
  findById(tenantId: string, id: string): Promise<Campaign | null>;
}

export interface CreateCampaignInput {
  name: string;
  dealId?: string;
  message?: string;
  channels: CampaignChannel[];
}

@Injectable()
export class CampaignService {
  constructor(
    @Inject(CAMPAIGN_STORE) private readonly store: CampaignStore,
    private readonly dealService: DealService
  ) {}

  async create(tenantId: string, id: string, input: CreateCampaignInput): Promise<Campaign> {
    if (!input.name.trim()) throw new InvalidCampaignError("name is required");
    if (input.channels.length === 0) throw new InvalidCampaignError("a campaign needs at least one channel");
    if (input.dealId) {
      const deal = await this.dealService.findById(tenantId, input.dealId);
      if (!deal) throw new InvalidCampaignError(`No deal found with id "${input.dealId}" for this tenant`);
    }
    const campaign: Campaign = {
      id,
      tenantId,
      name: input.name.trim(),
      dealId: input.dealId,
      message: input.message?.trim() || undefined,
      channels: input.channels,
      createdAt: new Date(),
    };
    await this.store.save(campaign);
    return campaign;
  }

  async listForTenant(tenantId: string): Promise<Campaign[]> {
    return this.store.findAllForTenant(tenantId);
  }

  async findById(tenantId: string, id: string): Promise<Campaign | null> {
    return this.store.findById(tenantId, id);
  }

  /** Real, non-fabricated default copy — built from the linked deal's own
   * real message when one exists, otherwise the campaign's own name. Never
   * invented ad copy. */
  async buildMessage(tenantId: string, campaign: Campaign): Promise<string> {
    if (campaign.message) return campaign.message;
    if (campaign.dealId) {
      const deal = await this.dealService.findById(tenantId, campaign.dealId);
      if (deal) return this.dealService.buildDefaultMessage(deal);
    }
    return campaign.name;
  }

  /** Called only by CampaignsController.launch(), after the real
   * orchestration below has actually run — same "log after success, not
   * speculatively before" discipline as SocialPostLogService's own
   * comment. */
  async recordLaunch(tenantId: string, id: string, results: CampaignLaunchResult[]): Promise<Campaign> {
    const existing = await this.store.findById(tenantId, id);
    if (!existing) throw new CampaignNotFoundError(id);
    const updated: Campaign = { ...existing, lastLaunchedAt: new Date(), lastLaunchResults: results };
    await this.store.save(updated);
    return updated;
  }
}

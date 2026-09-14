import { Module } from "@nestjs/common";
import { Pool } from "pg";
import { CampaignsController } from "./campaigns.controller";
import { CampaignService, CampaignStore } from "./campaign.service";
import { InMemoryCampaignStore } from "./in-memory-campaign.store";
import { PgCampaignStore } from "./pg-campaign.store";
import { CAMPAIGN_STORE } from "./campaigns.tokens";
import { PG_POOL } from "../../common/database.module";
import { DealsModule } from "../deals/deals.module";
import { SocialPublishingModule } from "../social-publishing/social-publishing.module";
import { CustomerModule } from "../customers/customer.module";
import { AuthModule } from "../auth/auth.module";
import { AccessTokenGuard } from "../auth/access-token.guard";

@Module({
  // DealsModule: a campaign can optionally reuse a Deal's own content/ad
  // image. SocialPublishingModule: the real Facebook/Instagram posting
  // machinery, same as DealsModule already imports it for its own
  // publish(). CustomerModule: the real customer list a WhatsApp campaign
  // broadcasts to. No cycle: none of these three import this new module.
  imports: [DealsModule, SocialPublishingModule, CustomerModule, AuthModule],
  controllers: [CampaignsController],
  providers: [
    CampaignService,
    // Re-declared locally — see SalesModule's own comment.
    AccessTokenGuard,
    {
      provide: CAMPAIGN_STORE,
      inject: [PG_POOL],
      useFactory: (pool: Pool | null): CampaignStore => (pool ? new PgCampaignStore(pool) : new InMemoryCampaignStore()),
    },
  ],
})
export class CampaignsModule {}

import { Module } from "@nestjs/common";
import { Pool } from "pg";
import { GrowthAuditController } from "./growth-audit.controller";
import { GrowthAuditService, GrowthAuditResponseStore } from "./growth-audit.service";
import { InMemoryGrowthAuditResponseStore } from "./in-memory-growth-audit-response.store";
import { PgGrowthAuditResponseStore } from "./pg-growth-audit-response.store";
import { RecommendationController } from "./recommendation.controller";
import { RecommendationService, RecommendationStore } from "./recommendation.service";
import { InMemoryRecommendationStore } from "./in-memory-recommendation.store";
import { PgRecommendationStore } from "./pg-recommendation.store";
import { GROWTH_AUDIT_RESPONSE_STORE, RECOMMENDATION_STORE } from "./growth-audit.tokens";
import { PG_POOL } from "../../common/database.module";
import { AutomationModule } from "../automation/automation.module";
import { SalesModule } from "../sales/sales.module";
import { RatingModule } from "../reputation/rating.module";
import { DealsModule } from "../deals/deals.module";
import { SocialPublishingModule } from "../social-publishing/social-publishing.module";
import { AuthModule } from "../auth/auth.module";
import { AccessTokenGuard } from "../auth/access-token.guard";

/**
 * RecommendationService (recommendation.service.ts) pulls together real
 * signals from Sales (KpiBenchmarkService), Reputation (RatingService),
 * Deals (DealService), Social Publishing (SocialPostLogService), and Auth
 * (TenantService, for the notification phone) — hence the wider import
 * list here than this module needed before 2026-09-10. No circular
 * dependency: none of these modules import GrowthAuditModule back.
 */
@Module({
  imports: [AutomationModule, SalesModule, RatingModule, DealsModule, SocialPublishingModule, AuthModule],
  controllers: [GrowthAuditController, RecommendationController],
  providers: [
    GrowthAuditService,
    RecommendationService,
    // Re-declared locally — see SalesModule's own comment.
    AccessTokenGuard,
    {
      provide: GROWTH_AUDIT_RESPONSE_STORE,
      inject: [PG_POOL],
      useFactory: (pool: Pool | null): GrowthAuditResponseStore =>
        pool ? new PgGrowthAuditResponseStore(pool) : new InMemoryGrowthAuditResponseStore(),
    },
    {
      provide: RECOMMENDATION_STORE,
      inject: [PG_POOL],
      useFactory: (pool: Pool | null): RecommendationStore => (pool ? new PgRecommendationStore(pool) : new InMemoryRecommendationStore()),
    },
  ],
  // Exported 2026-09-10 so OnboardingModule/AdminModule/ReportsModule can
  // inject the real GrowthAuditService/RecommendationService directly —
  // same gap already found and fixed on AuthModule/CustomerModule.
  exports: [GrowthAuditService, RecommendationService],
})
export class GrowthAuditModule {}

import { Module } from "@nestjs/common";
import { Pool } from "pg";
import { AnalyticsController } from "./analytics.controller";
import { AnalyticsService, WebsiteVisitStore } from "./website-visit.service";
import { InMemoryWebsiteVisitStore } from "./in-memory-website-visit.store";
import { PgWebsiteVisitStore } from "./pg-website-visit.store";
import { WEBSITE_VISIT_STORE } from "./analytics.tokens";
import { PG_POOL } from "../../common/database.module";
import { AuthModule } from "../auth/auth.module";
import { AccessTokenGuard } from "../auth/access-token.guard";

/**
 * InMemoryWebsiteVisitStore (the DATABASE_URL-unset fallback, same as
 * every other feature module here) has one real gap the Postgres-backed
 * path doesn't: no RLS, so it's process-global rather than genuinely
 * tenant-isolated at the storage layer. Acceptable for the same reason
 * every other in-memory fallback here accepts it — it only ever runs
 * against a single local/dev process with no real multi-tenant data in
 * play, and application-layer authorize() (analytics.controller.ts) still
 * gates the one endpoint that reads it back.
 */
@Module({
  imports: [AuthModule],
  controllers: [AnalyticsController],
  providers: [
    AnalyticsService,
    // Re-declared locally even though AuthModule already exports it — a
    // guard referenced by class in @UseGuards() resolves through the
    // CONSUMING module's own injector, not the exporting one. Same real gap
    // found and fixed on PaymentsModule/SupportTicketModule/SalesModule.
    AccessTokenGuard,
    {
      provide: WEBSITE_VISIT_STORE,
      inject: [PG_POOL],
      useFactory: (pool: Pool | null): WebsiteVisitStore => (pool ? new PgWebsiteVisitStore(pool) : new InMemoryWebsiteVisitStore()),
    },
  ],
  exports: [AnalyticsService],
})
export class AnalyticsModule {}

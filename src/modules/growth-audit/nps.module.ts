import { Module } from "@nestjs/common";
import { Pool } from "pg";
import { NpsController } from "./nps.controller";
import { NpsService, NpsResponseStore } from "./nps.service";
import { InMemoryNpsResponseStore } from "./in-memory-nps-response.store";
import { PgNpsResponseStore } from "./pg-nps-response.store";
import { NPS_RESPONSE_STORE } from "./nps.tokens";
import { PG_POOL } from "../../common/database.module";
import { AutomationModule } from "../automation/automation.module";
import { AuthModule } from "../auth/auth.module";
import { AccessTokenGuard } from "../auth/access-token.guard";

@Module({
  imports: [AutomationModule, AuthModule],
  controllers: [NpsController],
  providers: [
    NpsService,
    // Re-declared locally — see SalesModule's own comment.
    AccessTokenGuard,
    {
      provide: NPS_RESPONSE_STORE,
      inject: [PG_POOL],
      useFactory: (pool: Pool | null): NpsResponseStore => (pool ? new PgNpsResponseStore(pool) : new InMemoryNpsResponseStore()),
    },
  ],
  // Exported so the Sales module can inject NpsService for its conversion-
  // rate KPI (Master Plan Addendum v1.3, §E) — same reasoning CustomerModule
  // already established by importing RatingModule/ConsentModule.
  exports: [NpsService],
})
export class NpsModule {}

import { Module } from "@nestjs/common";
import { Pool } from "pg";
import { GrowthActionsController } from "./growth-actions.controller";
import { GrowthActionService, GrowthActionStore } from "./growth-action.service";
import { InMemoryGrowthActionStore } from "./in-memory-growth-action.store";
import { PgGrowthActionStore } from "./pg-growth-action.store";
import { GROWTH_ACTION_STORE } from "./growth-actions.tokens";
import { PG_POOL } from "../../common/database.module";
import { AuthModule } from "../auth/auth.module";
import { AccessTokenGuard } from "../auth/access-token.guard";

/** Exported so TriggersModule can inject GrowthActionService directly —
 * see trigger.service.ts's convertToAction(). No cycle: this module
 * never imports TriggersModule back (it only stores a plain
 * relatedTriggerId string, no runtime dependency on TriggerService). */
@Module({
  imports: [AuthModule],
  controllers: [GrowthActionsController],
  providers: [
    GrowthActionService,
    // Re-declared locally — see SalesModule's own comment.
    AccessTokenGuard,
    {
      provide: GROWTH_ACTION_STORE,
      inject: [PG_POOL],
      useFactory: (pool: Pool | null): GrowthActionStore => (pool ? new PgGrowthActionStore(pool) : new InMemoryGrowthActionStore()),
    },
  ],
  exports: [GrowthActionService],
})
export class GrowthActionsModule {}

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
import { GoalsModule } from "../goals/goals.module";

/** Exported so TriggersModule can inject GrowthActionService directly —
 * see trigger.service.ts's convertToAction(). No cycle: this module
 * never imports TriggersModule back (it only stores a plain
 * relatedTriggerId string, no runtime dependency on TriggerService).
 * GoalsModule added for P1.2's relatedGoalId auto-linking
 * (GrowthActionService injects GoalService directly) — confirmed no
 * cycle: GoalsModule only imports AuthModule (deliberately not
 * SalesModule — see goals.module.ts's own comment on why). */
@Module({
  imports: [AuthModule, GoalsModule],
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

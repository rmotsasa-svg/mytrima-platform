import { Module } from "@nestjs/common";
import { Pool } from "pg";
import { GoalsController } from "./goals.controller";
import { GoalService, GoalStore } from "./goal.service";
import { InMemoryGoalStore } from "./in-memory-goal.store";
import { PgGoalStore } from "./pg-goal.store";
import { GOAL_STORE } from "./goals.tokens";
import { PG_POOL } from "../../common/database.module";
import { AuthModule } from "../auth/auth.module";
import { AccessTokenGuard } from "../auth/access-token.guard";

/** Exported so Phase 8's onboarding wizard (step 2, "what are you trying
 * to achieve") and Phase 7's Dashboard can inject GoalService directly. */
@Module({
  imports: [AuthModule],
  controllers: [GoalsController],
  providers: [
    GoalService,
    // Re-declared locally — see SalesModule's own comment.
    AccessTokenGuard,
    {
      provide: GOAL_STORE,
      inject: [PG_POOL],
      useFactory: (pool: Pool | null): GoalStore => (pool ? new PgGoalStore(pool) : new InMemoryGoalStore()),
    },
  ],
  exports: [GoalService],
})
export class GoalsModule {}

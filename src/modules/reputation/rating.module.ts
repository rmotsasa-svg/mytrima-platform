import { Module } from "@nestjs/common";
import { Pool } from "pg";
import { RatingController } from "./rating.controller";
import { RatingService, RatingStore } from "./rating.service";
import { InMemoryRatingStore } from "./in-memory-rating.store";
import { PgRatingStore } from "./pg-rating.store";
import { RATING_STORE } from "./reputation.tokens";
import { PG_POOL } from "../../common/database.module";
import { AutomationModule } from "../automation/automation.module";
import { AuthModule } from "../auth/auth.module";
import { AccessTokenGuard } from "../auth/access-token.guard";

@Module({
  imports: [AutomationModule, AuthModule],
  controllers: [RatingController],
  providers: [
    RatingService,
    // Re-declared locally — see SalesModule's own comment.
    AccessTokenGuard,
    {
      provide: RATING_STORE,
      inject: [PG_POOL],
      useFactory: (pool: Pool | null): RatingStore => (pool ? new PgRatingStore(pool) : new InMemoryRatingStore()),
    },
  ],
  // Exported so CustomerModule can build a customer activity view aggregating
  // ratings for a given customerId (see CustomerService.getActivity()).
  exports: [RatingService],
})
export class RatingModule {}

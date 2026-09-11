import { Module } from "@nestjs/common";
import { Pool } from "pg";
import { DealsController } from "./deals.controller";
import { DealService, DealStore } from "./deal.service";
import { InMemoryDealStore } from "./in-memory-deal.store";
import { PgDealStore } from "./pg-deal.store";
import { DEAL_STORE } from "./deals.tokens";
import { PG_POOL } from "../../common/database.module";
import { CatalogModule } from "../catalog/catalog.module";
import { AuthModule } from "../auth/auth.module";
import { AccessTokenGuard } from "../auth/access-token.guard";

@Module({
  imports: [CatalogModule, AuthModule],
  controllers: [DealsController],
  providers: [
    DealService,
    // Re-declared locally — see SalesModule's own comment.
    AccessTokenGuard,
    {
      provide: DEAL_STORE,
      inject: [PG_POOL],
      useFactory: (pool: Pool | null): DealStore => (pool ? new PgDealStore(pool) : new InMemoryDealStore()),
    },
  ],
  exports: [DealService],
})
export class DealsModule {}

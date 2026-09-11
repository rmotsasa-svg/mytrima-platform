import { Module } from "@nestjs/common";
import { Pool } from "pg";
import { SalesController } from "./sales.controller";
import { SaleService, SaleStore } from "./sale.service";
import { InMemorySaleStore } from "./in-memory-sale.store";
import { PgSaleStore } from "./pg-sale.store";
import { SalesTargetService, SalesTargetStore } from "./sales-target.service";
import { InMemorySalesTargetStore } from "./in-memory-sales-target.store";
import { PgSalesTargetStore } from "./pg-sales-target.store";
import { KpiBenchmarkService, KpiBenchmarkStore } from "./kpi-benchmark.service";
import { InMemoryKpiBenchmarkStore } from "./in-memory-kpi-benchmark.store";
import { PgKpiBenchmarkStore } from "./pg-kpi-benchmark.store";
import { KpiBenchmarkCheckService } from "./kpi-benchmark-check.service";
import { SALE_STORE, SALES_TARGET_STORE, KPI_BENCHMARK_STORE } from "./sales.tokens";
import { PG_POOL } from "../../common/database.module";
import { DealsModule } from "../deals/deals.module";
import { RatingModule } from "../reputation/rating.module";
import { NpsModule } from "../growth-audit/nps.module";
import { AutomationModule } from "../automation/automation.module";
import { AuthModule } from "../auth/auth.module";
import { AccessTokenGuard } from "../auth/access-token.guard";

@Module({
  imports: [DealsModule, RatingModule, NpsModule, AutomationModule, AuthModule],
  controllers: [SalesController],
  providers: [
    SaleService,
    SalesTargetService,
    KpiBenchmarkService,
    KpiBenchmarkCheckService,
    // Re-declared locally even though AuthModule already exports it — a
    // guard referenced by class in @UseGuards() resolves through the
    // CONSUMING module's own injector, not the exporting one. Same real gap
    // found and fixed on PaymentsModule/SupportTicketModule.
    AccessTokenGuard,
    {
      provide: SALE_STORE,
      inject: [PG_POOL],
      useFactory: (pool: Pool | null): SaleStore => (pool ? new PgSaleStore(pool) : new InMemorySaleStore()),
    },
    {
      provide: SALES_TARGET_STORE,
      inject: [PG_POOL],
      useFactory: (pool: Pool | null): SalesTargetStore => (pool ? new PgSalesTargetStore(pool) : new InMemorySalesTargetStore()),
    },
    {
      provide: KPI_BENCHMARK_STORE,
      inject: [PG_POOL],
      useFactory: (pool: Pool | null): KpiBenchmarkStore => (pool ? new PgKpiBenchmarkStore(pool) : new InMemoryKpiBenchmarkStore()),
    },
  ],
  // KpiBenchmarkService exported 2026-09-10 alongside SaleService so the
  // Growth Audit recommendation engine (recommendation.service.ts) can
  // check whether a tenant has already set a KPI benchmark, a real signal
  // for several of its recommended actions.
  exports: [SaleService, KpiBenchmarkService],
})
export class SalesModule {}

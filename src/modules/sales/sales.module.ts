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
import { RefundService, RefundStore } from "./refund.service";
import { InMemoryRefundStore } from "./in-memory-refund.store";
import { PgRefundStore } from "./pg-refund.store";
import { SALE_STORE, SALES_TARGET_STORE, KPI_BENCHMARK_STORE, REFUND_STORE } from "./sales.tokens";
import { PG_POOL } from "../../common/database.module";
import { DealsModule } from "../deals/deals.module";
import { RatingModule } from "../reputation/rating.module";
import { NpsModule } from "../growth-audit/nps.module";
import { AutomationModule } from "../automation/automation.module";
import { AuthModule } from "../auth/auth.module";
import { AccessTokenGuard } from "../auth/access-token.guard";
import { CatalogModule } from "../catalog/catalog.module";

@Module({
  // CatalogModule added 2026-09-12 — SaleService.computeProductContribution()
  // resolves each sale's catalogItemId to a real product/service name. No
  // cycle: DealsModule already imports CatalogModule the same way.
  imports: [DealsModule, RatingModule, NpsModule, AutomationModule, AuthModule, CatalogModule],
  controllers: [SalesController],
  providers: [
    SaleService,
    SalesTargetService,
    KpiBenchmarkService,
    KpiBenchmarkCheckService,
    RefundService,
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
    {
      provide: REFUND_STORE,
      inject: [PG_POOL],
      useFactory: (pool: Pool | null): RefundStore => (pool ? new PgRefundStore(pool) : new InMemoryRefundStore()),
    },
  ],
  // KpiBenchmarkService exported 2026-09-10 alongside SaleService so the
  // Growth Audit recommendation engine (recommendation.service.ts) can
  // check whether a tenant has already set a KPI benchmark, a real signal
  // for several of its recommended actions. SalesTargetService/RefundService
  // exported 2026-09-12 so SnapshotService (reports/snapshot.service.ts)
  // can compute the Business Snapshot's real Budget (from a tenant's own
  // Sales Target) and Actual/refund-netted figures without either concern
  // needing to live inside SnapshotService itself.
  exports: [SaleService, KpiBenchmarkService, SalesTargetService, RefundService],
})
export class SalesModule {}

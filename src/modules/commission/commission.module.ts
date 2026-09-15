import { Module } from "@nestjs/common";
import { Pool } from "pg";
import { StaffPerformanceController } from "./staff-performance.controller";
import { StaffPerformanceService } from "./staff-performance.service";
import { CommissionService, CommissionRateStore } from "./commission.service";
import { InMemoryCommissionRateStore } from "./in-memory-commission-rate.store";
import { PgCommissionRateStore } from "./pg-commission-rate.store";
import { COMMISSION_RATE_STORE } from "./commission.tokens";
import { PG_POOL } from "../../common/database.module";
import { AuthModule } from "../auth/auth.module";
import { SalesModule } from "../sales/sales.module";
import { CustomerModule } from "../customers/customer.module";
import { AccessTokenGuard } from "../auth/access-token.guard";

/**
 * "Track staff performance" / "add staff commission module" — the
 * tenant's own explicit request (2026-09-15). A standalone module, not
 * folded into AuthModule/StaffController — SalesModule already imports
 * AuthModule (for AccessTokenGuard), so AuthModule importing SalesModule
 * back to get at SaleService would be a genuine two-way module cycle. This
 * module instead depends on AuthModule, SalesModule, AND CustomerModule
 * without any of them depending back on it, so the dependency graph stays
 * a plain DAG — no forwardRef() needed anywhere here, same reasoning
 * CustomerModule's own comment gives for why ITS SalesModule import needs
 * no forwardRef either.
 */
@Module({
  imports: [AuthModule, SalesModule, CustomerModule],
  controllers: [StaffPerformanceController],
  providers: [
    StaffPerformanceService,
    CommissionService,
    // Re-declared locally — see SalesModule's own comment on why a guard
    // referenced by class in @UseGuards() resolves through the CONSUMING
    // module's own injector, not the exporting one.
    AccessTokenGuard,
    {
      provide: COMMISSION_RATE_STORE,
      inject: [PG_POOL],
      useFactory: (pool: Pool | null): CommissionRateStore => (pool ? new PgCommissionRateStore(pool) : new InMemoryCommissionRateStore()),
    },
  ],
})
export class CommissionModule {}

import { Module } from "@nestjs/common";
import { Pool } from "pg";
import { QuotationController } from "./quotation.controller";
import { QuotationService, QuotationStore } from "./quotation.service";
import { InMemoryQuotationStore } from "./in-memory-quotation.store";
import { PgQuotationStore } from "./pg-quotation.store";
import { QuotationStaleCheckService } from "./quotation-stale-check.service";
import { QUOTATION_STORE } from "./quotation.tokens";
import { PG_POOL } from "../../common/database.module";
import { AuthModule } from "../auth/auth.module";
import { CustomerModule } from "../customers/customer.module";
import { SalesModule } from "../sales/sales.module";
import { AutomationModule } from "../automation/automation.module";
import { TriggersModule } from "../triggers/triggers.module";
import { AccessTokenGuard } from "../auth/access-token.guard";

/**
 * "Let's add a quotation module" — the tenant's own explicit request
 * (2026-09-16). Imports CustomerModule to resolve a quotation's linked
 * customer's own email/phone at send time (QuotationController.send()) —
 * no cycle: CustomerModule doesn't import this module back, the same
 * reasoning CommissionModule's own comment gives for its identical
 * AuthModule/SalesModule/CustomerModule imports. SalesModule added for
 * P2.2's convert-to-sale endpoint (QuotationController injects
 * SaleService directly) — confirmed no cycle: nothing in SalesModule's
 * own import chain reaches back to QuotationModule. AutomationModule/
 * TriggersModule added for P2.1's QuotationStaleCheckService, same
 * imports CrmModule's own identical CrmStaleLeadCheckService needs.
 */
@Module({
  imports: [AuthModule, CustomerModule, SalesModule, AutomationModule, TriggersModule],
  controllers: [QuotationController],
  providers: [
    QuotationService,
    QuotationStaleCheckService,
    // Re-declared locally — see SalesModule's own comment.
    AccessTokenGuard,
    {
      provide: QUOTATION_STORE,
      inject: [PG_POOL],
      useFactory: (pool: Pool | null): QuotationStore => (pool ? new PgQuotationStore(pool) : new InMemoryQuotationStore()),
    },
  ],
})
export class QuotationModule {}

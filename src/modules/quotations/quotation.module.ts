import { Module } from "@nestjs/common";
import { Pool } from "pg";
import { QuotationController } from "./quotation.controller";
import { QuotationService, QuotationStore } from "./quotation.service";
import { InMemoryQuotationStore } from "./in-memory-quotation.store";
import { PgQuotationStore } from "./pg-quotation.store";
import { QUOTATION_STORE } from "./quotation.tokens";
import { PG_POOL } from "../../common/database.module";
import { AuthModule } from "../auth/auth.module";
import { CustomerModule } from "../customers/customer.module";
import { AccessTokenGuard } from "../auth/access-token.guard";

/**
 * "Let's add a quotation module" — the tenant's own explicit request
 * (2026-09-16). Imports CustomerModule to resolve a quotation's linked
 * customer's own email/phone at send time (QuotationController.send()) —
 * no cycle: CustomerModule doesn't import this module back, the same
 * reasoning CommissionModule's own comment gives for its identical
 * AuthModule/SalesModule/CustomerModule imports.
 */
@Module({
  imports: [AuthModule, CustomerModule],
  controllers: [QuotationController],
  providers: [
    QuotationService,
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

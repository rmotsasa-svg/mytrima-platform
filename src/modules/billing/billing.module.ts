import { Module } from "@nestjs/common";
import { Pool } from "pg";
import { BillingController } from "./billing.controller";
import { BillingService, SubscriptionStore, SubscriptionPaymentStore } from "./billing.service";
import { InMemorySubscriptionStore, InMemorySubscriptionPaymentStore } from "./in-memory-billing.store";
import { PgSubscriptionStore, PgSubscriptionPaymentStore } from "./pg-billing.store";
import { SUBSCRIPTION_STORE, SUBSCRIPTION_PAYMENT_STORE, MOPAY_API_KEY } from "./billing.tokens";
import { PG_POOL } from "../../common/database.module";
import { AuthModule } from "../auth/auth.module";
import { AccessTokenGuard } from "../auth/access-token.guard";

/**
 * No dev-only fallback for MOPAY_API_KEY, same reasoning as
 * PaymentsModule's own PAYFAST_MERCHANT_ID/PAYFAST_MERCHANT_KEY comment: a
 * fake key doesn't let checkout "work insecurely," it just fails outright
 * against the real MoPay gateway (MoPayNotConfiguredError, thrown by
 * BillingService before ever calling MoPayService) — no equivalent
 * footgun to guard against by inventing a default.
 */
@Module({
  imports: [AuthModule],
  controllers: [BillingController],
  providers: [
    BillingService,
    // Re-declared locally — see BookingModule/SalesModule's own comment:
    // a guard referenced by class in @UseGuards() resolves through the
    // CONSUMING module's own injector, not the exporting one.
    AccessTokenGuard,
    {
      provide: SUBSCRIPTION_STORE,
      inject: [PG_POOL],
      useFactory: (pool: Pool | null): SubscriptionStore => (pool ? new PgSubscriptionStore(pool) : new InMemorySubscriptionStore()),
    },
    {
      provide: SUBSCRIPTION_PAYMENT_STORE,
      inject: [PG_POOL],
      useFactory: (pool: Pool | null): SubscriptionPaymentStore =>
        pool ? new PgSubscriptionPaymentStore(pool) : new InMemorySubscriptionPaymentStore(),
    },
    { provide: MOPAY_API_KEY, useValue: process.env.MOPAY_API_KEY ?? "" },
  ],
  exports: [BillingService],
})
export class BillingModule {}

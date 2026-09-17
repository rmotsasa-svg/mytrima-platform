import { Module } from "@nestjs/common";
import { Pool } from "pg";
import { BillingController } from "./billing.controller";
import { SubscriptionService, SubscriptionPaymentStore } from "./subscription.service";
import { InMemorySubscriptionPaymentStore } from "./in-memory-subscription-payment.store";
import { PgSubscriptionPaymentStore } from "./pg-subscription-payment.store";
import { SubscriptionBillingCheckService } from "./subscription-billing-check.service";
import { SUBSCRIPTION_PAYMENT_STORE, MOPAY_PLATFORM_API_KEY } from "./billing.tokens";
import { PG_POOL } from "../../common/database.module";
import { AuthModule } from "../auth/auth.module";
import { AccessTokenGuard } from "../auth/access-token.guard";
import { EmailService, createEmailService } from "../integrations/email/email.service";
import { EMAIL_SERVICE } from "../integrations/email/email.tokens";

/**
 * B2 of "ACTION PROPOSED ADDITIONS IN PRIORITY ORDER" — see
 * subscription.service.ts's own top comment for the full design.
 * EMAIL_SERVICE re-declared locally, same reasoning as AccessTokenGuard
 * below (AuthModule doesn't export EMAIL_SERVICE) — SubscriptionBillingCheckService
 * needs it directly for renewal reminders, the same real client
 * QuotationController/CustomerController already send through.
 */
@Module({
  imports: [AuthModule],
  controllers: [BillingController],
  providers: [
    SubscriptionService,
    SubscriptionBillingCheckService,
    // Re-declared locally — see SalesModule's own comment.
    AccessTokenGuard,
    { provide: EMAIL_SERVICE, useFactory: (): EmailService => createEmailService() },
    { provide: MOPAY_PLATFORM_API_KEY, useValue: process.env.MOPAY_PLATFORM_API_KEY ?? "" },
    {
      provide: SUBSCRIPTION_PAYMENT_STORE,
      inject: [PG_POOL],
      useFactory: (pool: Pool | null): SubscriptionPaymentStore => (pool ? new PgSubscriptionPaymentStore(pool) : new InMemorySubscriptionPaymentStore()),
    },
  ],
  // Exported for Phase 2 of the admin-platform plan — AdminModule's own
  // AdminTenantService needs a tenant's real subscription-payment history
  // for its detail view. No cycle: AuthModule (this module's only import)
  // never imports AdminModule back.
  exports: [SubscriptionService],
})
export class BillingModule {}

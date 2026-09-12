import { Module } from "@nestjs/common";
import { AppController } from "./app.controller";
import { DatabaseModule } from "./common/database.module";
import { QueueModule } from "./common/queue.module";
import { GrowthAuditModule } from "./modules/growth-audit/growth-audit.module";
import { NpsModule } from "./modules/growth-audit/nps.module";
import { ConsentModule } from "./modules/compliance/consent.module";
import { RatingModule } from "./modules/reputation/rating.module";
import { AuthModule } from "./modules/auth/auth.module";
import { CustomerModule } from "./modules/customers/customer.module";
import { AutomationModule } from "./modules/automation/automation.module";
import { CatalogModule } from "./modules/catalog/catalog.module";
import { DealsModule } from "./modules/deals/deals.module";
import { PettyCashModule } from "./modules/petty-cash/petty-cash.module";
import { SalesModule } from "./modules/sales/sales.module";
import { SocialPublishingModule } from "./modules/social-publishing/social-publishing.module";
import { PaymentsModule } from "./modules/payments/payments.module";
import { OnboardingModule } from "./modules/onboarding/onboarding.module";
import { AdminModule } from "./modules/admin/admin.module";
import { ReportsModule } from "./modules/reports/reports.module";
import { BookingModule } from "./modules/booking/booking.module";
import { SupportTicketModule } from "./modules/support/support-ticket.module";
import { AnalyticsModule } from "./modules/analytics/analytics.module";
import { BillingModule } from "./modules/billing/billing.module";

/**
 * Every module wired in here is real, tested business logic (see each
 * module's own file for its specific known gaps). Deliberately NOT wired in:
 * the integration stubs under src/modules/integrations/ — they have no
 * controller to expose and exist purely to throw PendingVerificationError,
 * so there is nothing for the DI container to usefully do with them yet.
 *
 * DatabaseModule (Global) makes a single shared Postgres pool available to
 * every feature module below — each one falls back to its InMemory* store
 * automatically when DATABASE_URL is unset, so this app boots and the
 * dashboard works with zero configuration either way. QueueModule (Global)
 * does the same for the notification job queue: falls back to a no-op when
 * REDIS_URL is unset — see src/common/queue.module.ts.
 */
@Module({
  imports: [
    DatabaseModule,
    QueueModule,
    AutomationModule,
    GrowthAuditModule,
    NpsModule,
    ConsentModule,
    RatingModule,
    AuthModule,
    CustomerModule,
    CatalogModule,
    DealsModule,
    PettyCashModule,
    SalesModule,
    SocialPublishingModule,
    PaymentsModule,
    OnboardingModule,
    AdminModule,
    ReportsModule,
    BookingModule,
    SupportTicketModule,
    AnalyticsModule,
    BillingModule,
  ],
  controllers: [AppController],
})
export class AppModule {}

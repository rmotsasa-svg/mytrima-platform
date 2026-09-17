import { Module } from "@nestjs/common";
import { AdminController } from "./admin.controller";
import { PilotSummaryService } from "./pilot-summary.service";
import { SupportTicketAdminService } from "./support-ticket-admin.service";
import { AdminTenantService } from "./admin-tenant.service";
import { GrowthAuditModule } from "../growth-audit/growth-audit.module";
import { NpsModule } from "../growth-audit/nps.module";
import { OnboardingModule } from "../onboarding/onboarding.module";
import { SupportTicketModule } from "../support/support-ticket.module";
import { AdminAuthModule } from "../admin-auth/admin-auth.module";
import { AdminAccessTokenGuard } from "../admin-auth/admin-access-token.guard";
import { AuthModule } from "../auth/auth.module";
import { BillingModule } from "../billing/billing.module";

/** AuthModule/BillingModule added for Phase 2's AdminTenantService (real
 * staff listing + subscription-payment history per tenant) — confirmed
 * no cycle: neither module (nor anything either imports) imports
 * AdminModule back. */
@Module({
  imports: [GrowthAuditModule, NpsModule, OnboardingModule, SupportTicketModule, AdminAuthModule, AuthModule, BillingModule],
  controllers: [AdminController],
  // AdminAccessTokenGuard re-declared locally — see SalesModule's own
  // comment: a guard referenced by class in @UseGuards() resolves through
  // the CONSUMING module's own injector, not the exporting one.
  providers: [PilotSummaryService, SupportTicketAdminService, AdminTenantService, AdminAccessTokenGuard],
})
export class AdminModule {}

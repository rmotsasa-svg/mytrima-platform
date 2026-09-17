import { Module } from "@nestjs/common";
import { AdminController } from "./admin.controller";
import { PilotSummaryService } from "./pilot-summary.service";
import { SupportTicketAdminService } from "./support-ticket-admin.service";
import { GrowthAuditModule } from "../growth-audit/growth-audit.module";
import { NpsModule } from "../growth-audit/nps.module";
import { OnboardingModule } from "../onboarding/onboarding.module";
import { SupportTicketModule } from "../support/support-ticket.module";
import { AdminAuthModule } from "../admin-auth/admin-auth.module";
import { AdminAccessTokenGuard } from "../admin-auth/admin-access-token.guard";

@Module({
  imports: [GrowthAuditModule, NpsModule, OnboardingModule, SupportTicketModule, AdminAuthModule],
  controllers: [AdminController],
  // AdminAccessTokenGuard re-declared locally — see SalesModule's own
  // comment: a guard referenced by class in @UseGuards() resolves through
  // the CONSUMING module's own injector, not the exporting one.
  providers: [PilotSummaryService, SupportTicketAdminService, AdminAccessTokenGuard],
})
export class AdminModule {}

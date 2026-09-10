import { Module } from "@nestjs/common";
import { AdminController } from "./admin.controller";
import { PilotSummaryService } from "./pilot-summary.service";
import { SupportTicketAdminService } from "./support-ticket-admin.service";
import { GrowthAuditModule } from "../growth-audit/growth-audit.module";
import { NpsModule } from "../growth-audit/nps.module";
import { OnboardingModule } from "../onboarding/onboarding.module";
import { SupportTicketModule } from "../support/support-ticket.module";

@Module({
  imports: [GrowthAuditModule, NpsModule, OnboardingModule, SupportTicketModule],
  controllers: [AdminController],
  providers: [PilotSummaryService, SupportTicketAdminService],
})
export class AdminModule {}

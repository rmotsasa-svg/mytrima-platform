import { Module } from "@nestjs/common";
import { AdminController } from "./admin.controller";
import { PilotSummaryService } from "./pilot-summary.service";
import { GrowthAuditModule } from "../growth-audit/growth-audit.module";
import { NpsModule } from "../growth-audit/nps.module";
import { OnboardingModule } from "../onboarding/onboarding.module";

@Module({
  imports: [GrowthAuditModule, NpsModule, OnboardingModule],
  controllers: [AdminController],
  providers: [PilotSummaryService],
})
export class AdminModule {}

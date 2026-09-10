import { Module } from "@nestjs/common";
import { OnboardingController } from "./onboarding.controller";
import { OnboardingService } from "./onboarding.service";
import { AuthModule } from "../auth/auth.module";
import { GrowthAuditModule } from "../growth-audit/growth-audit.module";
import { SocialPublishingModule } from "../social-publishing/social-publishing.module";
import { CustomerModule } from "../customers/customer.module";

@Module({
  imports: [AuthModule, GrowthAuditModule, SocialPublishingModule, CustomerModule],
  controllers: [OnboardingController],
  providers: [OnboardingService],
  // Exported so AdminModule's PilotSummaryService can inject the real
  // OnboardingService directly — same real gap already found and fixed on
  // AuthModule/CustomerModule/GrowthAuditModule/SocialPublishingModule.
  exports: [OnboardingService],
})
export class OnboardingModule {}

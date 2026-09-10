import { Controller, Get, Param } from "@nestjs/common";
import { OnboardingService } from "./onboarding.service";

@Controller("onboarding")
export class OnboardingController {
  constructor(private readonly onboardingService: OnboardingService) {}

  @Get(":tenantId")
  getStatus(@Param("tenantId") tenantId: string) {
    return this.onboardingService.getStatus(tenantId);
  }
}

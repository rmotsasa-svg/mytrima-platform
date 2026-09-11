import { Controller, Get, Param, UseGuards } from "@nestjs/common";
import { OnboardingService } from "./onboarding.service";
import { AccessTokenGuard } from "../auth/access-token.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import { VerifiedAccessToken } from "../auth/auth.service";
import { authorize } from "../auth/rbac";

/** Gated 2026-09-11 — closes the real gap the Platform Readiness Assessment
 * flagged. `onboarding:view` is available to every role, read_only
 * included — it's a pure computed checklist, no write path exists. */
@UseGuards(AccessTokenGuard)
@Controller("onboarding")
export class OnboardingController {
  constructor(private readonly onboardingService: OnboardingService) {}

  @Get(":tenantId")
  getStatus(@CurrentUser() actor: VerifiedAccessToken, @Param("tenantId") tenantId: string) {
    authorize(actor, tenantId, "onboarding:view");
    return this.onboardingService.getStatus(tenantId);
  }
}

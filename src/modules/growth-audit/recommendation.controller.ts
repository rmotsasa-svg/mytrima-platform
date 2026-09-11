import { Controller, Get, Param, UseGuards } from "@nestjs/common";
import { RecommendationService } from "./recommendation.service";
import { AccessTokenGuard } from "../auth/access-token.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import { VerifiedAccessToken } from "../auth/auth.service";
import { authorize } from "../auth/rbac";

/** Gated 2026-09-11 — closes the real gap the Platform Readiness Assessment
 * flagged. Reuses `growth_audit:view` rather than inventing a separate
 * `recommendation:view` permission — the recommendation engine's output is
 * conceptually derived from the same Growth Audit data, not a distinct
 * domain a role could reasonably have different access to. */
@UseGuards(AccessTokenGuard)
@Controller("growth-audit")
export class RecommendationController {
  constructor(private readonly recommendationService: RecommendationService) {}

  /** The closed loop: diagnose (existing POST /growth-audit) -> prescribe
   * (this) -> track whether the tenant actually acted (this endpoint's own
   * lazy detection on every real fetch — see RecommendationService's own
   * comment). */
  @Get(":tenantId/recommendations")
  getRecommendations(@CurrentUser() actor: VerifiedAccessToken, @Param("tenantId") tenantId: string) {
    authorize(actor, tenantId, "growth_audit:view");
    return this.recommendationService.getRecommendations(tenantId);
  }
}

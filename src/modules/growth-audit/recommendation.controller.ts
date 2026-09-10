import { Controller, Get, Param } from "@nestjs/common";
import { RecommendationService } from "./recommendation.service";

@Controller("growth-audit")
export class RecommendationController {
  constructor(private readonly recommendationService: RecommendationService) {}

  /** The closed loop: diagnose (existing POST /growth-audit) -> prescribe
   * (this) -> track whether the tenant actually acted (this endpoint's own
   * lazy detection on every real fetch — see RecommendationService's own
   * comment). */
  @Get(":tenantId/recommendations")
  getRecommendations(@Param("tenantId") tenantId: string) {
    return this.recommendationService.getRecommendations(tenantId);
  }
}

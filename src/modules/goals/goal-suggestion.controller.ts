import { Controller, Get, NotFoundException, Param, UseGuards } from "@nestjs/common";
import { GoalService, GoalMetricType } from "./goal.service";
import { SaleService } from "../sales/sale.service";
import { AccessTokenGuard } from "../auth/access-token.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import { VerifiedAccessToken } from "../auth/auth.service";
import { authorize } from "../auth/rbac";

/** Which real SalesKpis field each GoalMetricType names — see
 * SaleService.computeKpis()'s own field list. Exhaustive, same discipline
 * as goal.service.ts's businessAreaForMetricType(): a new GoalMetricType
 * that forgets to extend this switch fails to compile. */
function suggestedValueFromKpis(metricType: GoalMetricType, kpis: Awaited<ReturnType<SaleService["computeKpis"]>>): number | null {
  switch (metricType) {
    case "sales_amount":
      return kpis.salesAmount;
    case "conversion_rate":
      return kpis.conversionRate;
    case "churn_rate":
      return kpis.churnRate;
    case "average_rating":
      return kpis.averageRating;
    case "nps_score":
      return kpis.averageNpsScore;
  }
}

/**
 * "Auto-suggest the real KPI value when updating a Goal" — the tenant's
 * own explicit request from the 360 assessment (P1.1). A standalone
 * controller/module (see goal-suggestion.module.ts's own comment on why
 * this isn't just another route on GoalsController) that needs both
 * GoalService and SaleService.
 */
@UseGuards(AccessTokenGuard)
@Controller("goals")
export class GoalSuggestionController {
  constructor(
    private readonly goalService: GoalService,
    private readonly saleService: SaleService
  ) {}

  /**
   * Returns null (not an error) whenever there's honestly nothing to
   * suggest: no metricType set on this goal at all, or
   * SaleService.computeKpis() itself returning null for that field (e.g.
   * no rated/NPS'd customers this period) — the frontend leaves
   * currentValue exactly as the tenant already typed it in either case,
   * never overwriting a real edit with a fabricated number. Period is the
   * trailing 30 days ending now — a Goal has no period concept of its own
   * (unlike a Sales Target), so this picks the one window every KPI on
   * this platform already treats as "current."
   */
  @Get(":tenantId/:goalId/suggested-value")
  async getSuggestedValue(@CurrentUser() actor: VerifiedAccessToken, @Param("tenantId") tenantId: string, @Param("goalId") goalId: string) {
    authorize(actor, tenantId, "goals:view");
    const goal = await this.goalService.findById(tenantId, goalId);
    if (!goal) throw new NotFoundException(`No goal found with id "${goalId}"`);
    if (!goal.metricType) return { suggestedValue: null };
    const periodEnd = new Date();
    const periodStart = new Date(periodEnd.getTime() - 30 * 24 * 60 * 60 * 1000);
    const kpis = await this.saleService.computeKpis(tenantId, periodStart, periodEnd);
    return { suggestedValue: suggestedValueFromKpis(goal.metricType, kpis) };
  }
}

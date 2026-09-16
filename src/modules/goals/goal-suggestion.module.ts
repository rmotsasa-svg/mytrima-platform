import { Module } from "@nestjs/common";
import { GoalSuggestionController } from "./goal-suggestion.controller";
import { GoalsModule } from "./goals.module";
import { SalesModule } from "../sales/sales.module";
import { AuthModule } from "../auth/auth.module";
import { AccessTokenGuard } from "../auth/access-token.guard";

/**
 * Standalone module — same "standalone-module-to-avoid-DI-cycle" pattern
 * as CommissionModule/QuotationModule. GoalsModule deliberately does not
 * import SalesModule itself: SalesModule -> TriggersModule ->
 * GrowthActionsModule already forms a chain, and GrowthActionsModule
 * needs to import GoalsModule (P1.2's relatedGoalId auto-linking), so a
 * direct GoalsModule -> SalesModule edge would close a real cycle
 * (GrowthActionsModule -> GoalsModule -> SalesModule -> TriggersModule ->
 * GrowthActionsModule). This module needs both GoalService and
 * SaleService for its one route (see goal-suggestion.controller.ts) and
 * sits outside that cycle entirely — nothing imports it back.
 */
@Module({
  imports: [GoalsModule, SalesModule, AuthModule],
  controllers: [GoalSuggestionController],
  providers: [
    // Re-declared locally — see SalesModule's own comment.
    AccessTokenGuard,
  ],
})
export class GoalSuggestionModule {}

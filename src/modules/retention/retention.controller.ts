import { Controller, Get, Param, UseGuards } from "@nestjs/common";
import { RetentionService } from "./retention.service";
import { AccessTokenGuard } from "../auth/access-token.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import { VerifiedAccessToken } from "../auth/auth.service";
import { authorize } from "../auth/rbac";

/** Reuses `customers:view` rather than inventing a `retention:view`
 * permission — this whole page is a computed lens over customer data, the
 * same "don't invent a permission split nothing has asked for" discipline
 * rbac.ts's own top comment establishes. No `:manage` route exists here at
 * all — Phase 6 is deliberately read-only (see retention.service.ts's own
 * comment); the one write action this page offers (creating a
 * GrowthAction to "contact N inactive customers") goes through the real
 * growth-actions:manage-gated endpoint directly, not through this module. */
@UseGuards(AccessTokenGuard)
@Controller("retention")
export class RetentionController {
  constructor(private readonly retentionService: RetentionService) {}

  @Get(":tenantId")
  summary(@CurrentUser() actor: VerifiedAccessToken, @Param("tenantId") tenantId: string) {
    authorize(actor, tenantId, "customers:view");
    return this.retentionService.retentionSummary(tenantId);
  }
}

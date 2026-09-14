import { Controller, Get, Param, Post, Query, UseGuards } from "@nestjs/common";
import { TriggerService, InvalidTriggerError, isValidTriggerStatus, TriggerStatus } from "./trigger.service";
import { AccessTokenGuard } from "../auth/access-token.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import { VerifiedAccessToken } from "../auth/auth.service";
import { authorize } from "../auth/rbac";

@UseGuards(AccessTokenGuard)
@Controller("triggers")
export class TriggersController {
  constructor(private readonly triggerService: TriggerService) {}

  /** `status` is optional — omitted means "every trigger regardless of
   * status" (the full history), not "open only"; the frontend's default
   * view chooses to filter to `open` itself (see TriggersPage.tsx), the
   * same "the API stays neutral, the page decides its own default" split
   * DealsController's own list() uses. */
  @Get(":tenantId")
  list(@CurrentUser() actor: VerifiedAccessToken, @Param("tenantId") tenantId: string, @Query("status") status?: string) {
    authorize(actor, tenantId, "triggers:view");
    if (status !== undefined && !isValidTriggerStatus(status)) {
      throw new InvalidTriggerError(`status must be one of "open", "actioned", "dismissed" — got "${status}"`);
    }
    return this.triggerService.listForTenant(tenantId, status as TriggerStatus | undefined);
  }

  @Post(":tenantId/:triggerId/dismiss")
  dismiss(@CurrentUser() actor: VerifiedAccessToken, @Param("tenantId") tenantId: string, @Param("triggerId") triggerId: string) {
    authorize(actor, tenantId, "triggers:manage");
    return this.triggerService.dismiss(tenantId, triggerId);
  }

  /** Phase 2 stub — see TriggerService.convertToAction()'s own comment.
   * Phase 4 (Growth Actions) changes what this creates, not this route. */
  @Post(":tenantId/:triggerId/convert-to-action")
  convertToAction(@CurrentUser() actor: VerifiedAccessToken, @Param("tenantId") tenantId: string, @Param("triggerId") triggerId: string) {
    authorize(actor, tenantId, "triggers:manage");
    return this.triggerService.convertToAction(tenantId, triggerId);
  }
}

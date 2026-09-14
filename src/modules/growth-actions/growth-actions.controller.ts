import { Body, Controller, Get, NotFoundException, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { GrowthActionService, GrowthActionPriority, GrowthActionStatus, InvalidGrowthActionError } from "./growth-action.service";
import { AccessTokenGuard } from "../auth/access-token.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import { VerifiedAccessToken } from "../auth/auth.service";
import { authorize } from "../auth/rbac";

interface CreateGrowthActionBody {
  title: string;
  reason: string;
  priority: GrowthActionPriority;
  expectedImpact: string;
  estimatedMinutes?: number;
  dueDate?: string;
  ownerUserId?: string;
  relatedGoalId?: string;
}

interface UpdateGrowthActionBody {
  title?: string;
  reason?: string;
  priority?: GrowthActionPriority;
  expectedImpact?: string;
  estimatedMinutes?: number;
  dueDate?: string;
  ownerUserId?: string;
  status?: GrowthActionStatus;
  result?: string;
}

const VALID_STATUSES: readonly GrowthActionStatus[] = ["todo", "in_progress", "done", "dismissed"];

@UseGuards(AccessTokenGuard)
@Controller("growth-actions")
export class GrowthActionsController {
  constructor(private readonly growthActionService: GrowthActionService) {}

  @Post(":tenantId")
  create(@CurrentUser() actor: VerifiedAccessToken, @Param("tenantId") tenantId: string, @Body() body: CreateGrowthActionBody) {
    authorize(actor, tenantId, "growth_actions:manage");
    return this.growthActionService.create(tenantId, randomUUID(), { ...body, dueDate: body.dueDate ? new Date(body.dueDate) : undefined });
  }

  /** `status` optional — omitted means every action regardless of status,
   * same "the API stays neutral, the page decides its own default" split
   * TriggersController.list() already uses. */
  @Get(":tenantId")
  list(@CurrentUser() actor: VerifiedAccessToken, @Param("tenantId") tenantId: string, @Query("status") status?: string) {
    authorize(actor, tenantId, "growth_actions:view");
    if (status !== undefined && !VALID_STATUSES.includes(status as GrowthActionStatus)) {
      throw new InvalidGrowthActionError(`status must be one of ${VALID_STATUSES.map((s) => `"${s}"`).join(", ")} — got "${status}"`);
    }
    return this.growthActionService.listForTenant(tenantId, status as GrowthActionStatus | undefined);
  }

  @Get(":tenantId/:actionId")
  async getOne(@CurrentUser() actor: VerifiedAccessToken, @Param("tenantId") tenantId: string, @Param("actionId") actionId: string) {
    authorize(actor, tenantId, "growth_actions:view");
    const action = await this.growthActionService.findById(tenantId, actionId);
    if (!action) throw new NotFoundException(`No growth action found with id "${actionId}"`);
    return action;
  }

  @Patch(":tenantId/:actionId")
  update(
    @CurrentUser() actor: VerifiedAccessToken,
    @Param("tenantId") tenantId: string,
    @Param("actionId") actionId: string,
    @Body() body: UpdateGrowthActionBody
  ) {
    authorize(actor, tenantId, "growth_actions:manage");
    return this.growthActionService.update(tenantId, actionId, { ...body, dueDate: body.dueDate !== undefined ? new Date(body.dueDate) : undefined });
  }
}

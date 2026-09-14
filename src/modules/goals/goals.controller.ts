import { Body, Controller, Get, NotFoundException, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { GoalService, GoalPriority, GoalStatus, computeProgressPct } from "./goal.service";
import { AccessTokenGuard } from "../auth/access-token.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import { VerifiedAccessToken } from "../auth/auth.service";
import { authorize } from "../auth/rbac";

interface CreateGoalBody {
  objective: string;
  metric: string;
  baselineValue: number;
  targetValue: number;
  deadline: string;
  ownerUserId?: string;
  priority: GoalPriority;
}

interface UpdateGoalBody {
  objective?: string;
  metric?: string;
  currentValue?: number;
  targetValue?: number;
  deadline?: string;
  ownerUserId?: string;
  priority?: GoalPriority;
  status?: GoalStatus;
}

/** `progressPct` is computed here, at the HTTP boundary, from the real
 * pure function — never stored, never duplicated. Every response below
 * that returns a Goal returns it wrapped with this. */
function withProgress<T extends { baselineValue: number; currentValue: number; targetValue: number }>(goal: T) {
  return { ...goal, progressPct: computeProgressPct(goal) };
}

@UseGuards(AccessTokenGuard)
@Controller("goals")
export class GoalsController {
  constructor(private readonly goalService: GoalService) {}

  @Post(":tenantId")
  async create(@CurrentUser() actor: VerifiedAccessToken, @Param("tenantId") tenantId: string, @Body() body: CreateGoalBody) {
    authorize(actor, tenantId, "goals:manage");
    const goal = await this.goalService.create(tenantId, randomUUID(), { ...body, deadline: new Date(body.deadline) });
    return withProgress(goal);
  }

  @Get(":tenantId")
  async list(@CurrentUser() actor: VerifiedAccessToken, @Param("tenantId") tenantId: string) {
    authorize(actor, tenantId, "goals:view");
    const goals = await this.goalService.listForTenant(tenantId);
    return goals.map(withProgress);
  }

  @Get(":tenantId/:goalId")
  async getOne(@CurrentUser() actor: VerifiedAccessToken, @Param("tenantId") tenantId: string, @Param("goalId") goalId: string) {
    authorize(actor, tenantId, "goals:view");
    const goal = await this.goalService.findById(tenantId, goalId);
    if (!goal) throw new NotFoundException(`No goal found with id "${goalId}"`);
    return withProgress(goal);
  }

  @Patch(":tenantId/:goalId")
  async update(
    @CurrentUser() actor: VerifiedAccessToken,
    @Param("tenantId") tenantId: string,
    @Param("goalId") goalId: string,
    @Body() body: UpdateGoalBody
  ) {
    authorize(actor, tenantId, "goals:manage");
    const goal = await this.goalService.update(tenantId, goalId, {
      ...body,
      deadline: body.deadline !== undefined ? new Date(body.deadline) : undefined,
    });
    return withProgress(goal);
  }
}

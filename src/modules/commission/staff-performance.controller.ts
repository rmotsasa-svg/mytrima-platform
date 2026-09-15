import { Body, Controller, Get, Param, Post, Query, UseGuards } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { StaffPerformanceService } from "./staff-performance.service";
import { CommissionService } from "./commission.service";
import { AuthService, VerifiedAccessToken } from "../auth/auth.service";
import { AccessTokenGuard } from "../auth/access-token.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import { authorize } from "../auth/rbac";

interface SetCommissionRateBody {
  ratePercent: number;
}

/**
 * "Track staff performance" / "add staff commission module" — the
 * tenant's own explicit request (2026-09-15). Same two-shape-of-route
 * pattern StaffController already uses (self-service vs owner/manager-
 * viewing-a-teammate): viewing your OWN performance/commission-rate needs
 * no extra permission (`userId === actor.userId`); viewing a TEAMMATE's
 * needs `user:manage`, the exact gate StaffController's own `/activity`
 * route already uses for the identical shape of question. Setting a
 * commission rate is different — a real compensation decision, gated by
 * `commission:manage` regardless of whose rate it is (see rbac.ts's own
 * comment on why this isn't just user:manage).
 */
@UseGuards(AccessTokenGuard)
@Controller("staff-performance")
export class StaffPerformanceController {
  constructor(
    private readonly staffPerformanceService: StaffPerformanceService,
    private readonly commissionService: CommissionService,
    private readonly authService: AuthService
  ) {}

  private defaultPeriod(periodStart?: string, periodEnd?: string): { start: Date; end: Date } {
    const end = periodEnd ? new Date(periodEnd) : new Date();
    const start = periodStart ? new Date(periodStart) : new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);
    return { start, end };
  }

  /** Every staff account's performance for the same period, one call —
   * gated user:manage since this is the owner/manager "whole team" view,
   * not a self-service route. */
  @Get(":tenantId")
  async listForTenant(
    @CurrentUser() actor: VerifiedAccessToken,
    @Param("tenantId") tenantId: string,
    @Query("periodStart") periodStart?: string,
    @Query("periodEnd") periodEnd?: string
  ) {
    authorize(actor, tenantId, "user:manage");
    const { start, end } = this.defaultPeriod(periodStart, periodEnd);
    const staff = await this.authService.listStaffForTenant(tenantId);
    return this.staffPerformanceService.computeForTenant(
      tenantId,
      staff.map((s) => s.id),
      start,
      end
    );
  }

  @Get(":tenantId/:userId")
  async getForUser(
    @CurrentUser() actor: VerifiedAccessToken,
    @Param("tenantId") tenantId: string,
    @Param("userId") userId: string,
    @Query("periodStart") periodStart?: string,
    @Query("periodEnd") periodEnd?: string
  ) {
    // "Self" only counts when the actor is also genuinely acting within
    // their own tenant — matches StaffController's own /:userId/activity
    // gate exactly (see that file's comment).
    if (userId !== actor.userId || actor.tenantId !== tenantId) {
      authorize(actor, tenantId, "user:manage");
    }
    const { start, end } = this.defaultPeriod(periodStart, periodEnd);
    return this.staffPerformanceService.computeForUser(tenantId, userId, start, end);
  }

  @Get(":tenantId/:userId/commission-rate")
  async getRate(@CurrentUser() actor: VerifiedAccessToken, @Param("tenantId") tenantId: string, @Param("userId") userId: string) {
    if (userId !== actor.userId || actor.tenantId !== tenantId) {
      authorize(actor, tenantId, "user:manage");
    }
    return this.commissionService.getRateForUser(tenantId, userId);
  }

  @Post(":tenantId/:userId/commission-rate")
  async setRate(
    @CurrentUser() actor: VerifiedAccessToken,
    @Param("tenantId") tenantId: string,
    @Param("userId") userId: string,
    @Body() body: SetCommissionRateBody
  ) {
    authorize(actor, tenantId, "commission:manage");
    return this.commissionService.setRate(tenantId, randomUUID(), userId, body.ratePercent);
  }
}

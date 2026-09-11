import { Controller, Get, Param, Query, UseGuards } from "@nestjs/common";
import { SnapshotService } from "./snapshot.service";
import { AccessTokenGuard } from "../auth/access-token.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import { VerifiedAccessToken } from "../auth/auth.service";
import { authorize } from "../auth/rbac";

/** Gated 2026-09-11 — closes the real gap the Platform Readiness Assessment
 * flagged. `reports:view` is available to every role, read_only included
 * — a report is inherently read-only. */
@UseGuards(AccessTokenGuard)
@Controller("reports")
export class SnapshotController {
  constructor(private readonly snapshotService: SnapshotService) {}

  /** The one place that answers "how is my business doing" — see
   * snapshot.service.ts's own top comment. Same 30-days-by-default period
   * as every other Sales endpoint. */
  @Get(":tenantId/snapshot")
  getSnapshot(
    @CurrentUser() actor: VerifiedAccessToken,
    @Param("tenantId") tenantId: string,
    @Query("periodStart") periodStart?: string,
    @Query("periodEnd") periodEnd?: string
  ) {
    authorize(actor, tenantId, "reports:view");
    const end = periodEnd ? new Date(periodEnd) : new Date();
    const start = periodStart ? new Date(periodStart) : new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);
    return this.snapshotService.getSnapshot(tenantId, { start, end });
  }
}

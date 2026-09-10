import { Controller, Get, Param, Query } from "@nestjs/common";
import { SnapshotService } from "./snapshot.service";

@Controller("reports")
export class SnapshotController {
  constructor(private readonly snapshotService: SnapshotService) {}

  /** The one place that answers "how is my business doing" — see
   * snapshot.service.ts's own top comment. Same 30-days-by-default period
   * as every other Sales endpoint. */
  @Get(":tenantId/snapshot")
  getSnapshot(@Param("tenantId") tenantId: string, @Query("periodStart") periodStart?: string, @Query("periodEnd") periodEnd?: string) {
    const end = periodEnd ? new Date(periodEnd) : new Date();
    const start = periodStart ? new Date(periodStart) : new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);
    return this.snapshotService.getSnapshot(tenantId, { start, end });
  }
}

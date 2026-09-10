import { Module } from "@nestjs/common";
import { SnapshotController } from "./snapshot.controller";
import { SnapshotService } from "./snapshot.service";
import { SalesModule } from "../sales/sales.module";
import { NpsModule } from "../growth-audit/nps.module";
import { RatingModule } from "../reputation/rating.module";
import { GrowthAuditModule } from "../growth-audit/growth-audit.module";

@Module({
  imports: [SalesModule, NpsModule, RatingModule, GrowthAuditModule],
  controllers: [SnapshotController],
  providers: [SnapshotService],
})
export class ReportsModule {}

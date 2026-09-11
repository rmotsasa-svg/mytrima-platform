import { Module } from "@nestjs/common";
import { SnapshotController } from "./snapshot.controller";
import { SnapshotService } from "./snapshot.service";
import { SalesModule } from "../sales/sales.module";
import { NpsModule } from "../growth-audit/nps.module";
import { RatingModule } from "../reputation/rating.module";
import { GrowthAuditModule } from "../growth-audit/growth-audit.module";
import { SocialPublishingModule } from "../social-publishing/social-publishing.module";
import { AuthModule } from "../auth/auth.module";
import { AccessTokenGuard } from "../auth/access-token.guard";

@Module({
  imports: [SalesModule, NpsModule, RatingModule, GrowthAuditModule, SocialPublishingModule, AuthModule],
  controllers: [SnapshotController],
  providers: [
    SnapshotService,
    // Re-declared locally — see SalesModule's own comment.
    AccessTokenGuard,
  ],
})
export class ReportsModule {}

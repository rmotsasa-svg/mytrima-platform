import { Module } from "@nestjs/common";
import { Pool } from "pg";
import { GrowthAuditController } from "./growth-audit.controller";
import { GrowthAuditService, GrowthAuditResponseStore } from "./growth-audit.service";
import { InMemoryGrowthAuditResponseStore } from "./in-memory-growth-audit-response.store";
import { PgGrowthAuditResponseStore } from "./pg-growth-audit-response.store";
import { GROWTH_AUDIT_RESPONSE_STORE } from "./growth-audit.tokens";
import { PG_POOL } from "../../common/database.module";
import { AutomationModule } from "../automation/automation.module";

@Module({
  imports: [AutomationModule],
  controllers: [GrowthAuditController],
  providers: [
    GrowthAuditService,
    {
      provide: GROWTH_AUDIT_RESPONSE_STORE,
      inject: [PG_POOL],
      useFactory: (pool: Pool | null): GrowthAuditResponseStore =>
        pool ? new PgGrowthAuditResponseStore(pool) : new InMemoryGrowthAuditResponseStore(),
    },
  ],
})
export class GrowthAuditModule {}

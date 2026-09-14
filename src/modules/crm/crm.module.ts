import { Module } from "@nestjs/common";
import { Pool } from "pg";
import { CrmController } from "./crm.controller";
import { CrmService, LeadStore, CrmActivityStore } from "./crm.service";
import { InMemoryLeadStore } from "./in-memory-lead.store";
import { PgLeadStore } from "./pg-lead.store";
import { InMemoryCrmActivityStore } from "./in-memory-crm-activity.store";
import { PgCrmActivityStore } from "./pg-crm-activity.store";
import { CrmStaleLeadCheckService } from "./crm-stale-lead-check.service";
import { LEAD_STORE, CRM_ACTIVITY_STORE } from "./crm.tokens";
import { PG_POOL } from "../../common/database.module";
import { CustomerModule } from "../customers/customer.module";
import { AutomationModule } from "../automation/automation.module";
import { TriggersModule } from "../triggers/triggers.module";
import { AuthModule } from "../auth/auth.module";
import { AccessTokenGuard } from "../auth/access-token.guard";

/**
 * Imports CustomerModule directly — no forwardRef needed, confirmed:
 * CustomerService never depends back on anything in this module (see the
 * plan's own conventions section on when forwardRef is/isn't required).
 */
@Module({
  imports: [CustomerModule, AutomationModule, TriggersModule, AuthModule],
  controllers: [CrmController],
  providers: [
    CrmService,
    CrmStaleLeadCheckService,
    // Re-declared locally — see SalesModule's own comment.
    AccessTokenGuard,
    {
      provide: LEAD_STORE,
      inject: [PG_POOL],
      useFactory: (pool: Pool | null): LeadStore => (pool ? new PgLeadStore(pool) : new InMemoryLeadStore()),
    },
    {
      provide: CRM_ACTIVITY_STORE,
      inject: [PG_POOL],
      useFactory: (pool: Pool | null): CrmActivityStore => (pool ? new PgCrmActivityStore(pool) : new InMemoryCrmActivityStore()),
    },
  ],
  exports: [CrmService],
})
export class CrmModule {}

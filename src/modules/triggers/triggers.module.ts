import { Module } from "@nestjs/common";
import { Pool } from "pg";
import { TriggersController } from "./triggers.controller";
import { TriggerService, TriggerStore } from "./trigger.service";
import { InMemoryTriggerStore } from "./in-memory-trigger.store";
import { PgTriggerStore } from "./pg-trigger.store";
import { TRIGGER_STORE } from "./triggers.tokens";
import { PG_POOL } from "../../common/database.module";
import { AuthModule } from "../auth/auth.module";
import { AccessTokenGuard } from "../auth/access-token.guard";
import { GrowthActionsModule } from "../growth-actions/growth-actions.module";

/**
 * Exported so every module whose controller/service already computes a
 * NotificationEvent[] (GrowthAuditModule, NpsModule, RatingModule,
 * SalesModule, BookingModule — see each's own real notificationsFor*()
 * call site) can inject TriggerService directly, the same way they already
 * import AutomationModule for NotificationDeliveryService.
 *
 * GrowthActionsModule imported Phase 4 — TriggerService.convertToAction()
 * now creates a real GrowthAction. No cycle: GrowthActionsModule never
 * imports TriggersModule back.
 */
@Module({
  imports: [AuthModule, GrowthActionsModule],
  controllers: [TriggersController],
  providers: [
    TriggerService,
    // Re-declared locally — see SalesModule's own comment.
    AccessTokenGuard,
    {
      provide: TRIGGER_STORE,
      inject: [PG_POOL],
      useFactory: (pool: Pool | null): TriggerStore => (pool ? new PgTriggerStore(pool) : new InMemoryTriggerStore()),
    },
  ],
  exports: [TriggerService],
})
export class TriggersModule {}

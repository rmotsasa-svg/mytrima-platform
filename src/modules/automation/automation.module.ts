import { Module } from "@nestjs/common";
import { NotificationDeliveryService } from "./notification-delivery.service";
import { NotificationWorkerService } from "./notification-worker.service";
import { AuthModule } from "../auth/auth.module";

/**
 * automation.service.ts's notificationsFor*() functions stay plain,
 * dependency-free pure functions with no module of their own (every
 * controller that uses them imports the file directly) — this module exists
 * only for the two pieces that need real DI/lifecycle management: the
 * queue producer and the in-process worker. Exported so any controller that
 * computes a NotificationEvent can enqueue it for real.
 *
 * Imports AuthModule (2026-09-10) purely for its exported TENANT_STORE —
 * NotificationWorkerService needs to resolve a tenant's real notification
 * phone number (see notification-worker.service.ts) and that's the only
 * place that record lives. Not a circular dependency: AuthModule imports
 * nothing from here.
 */
@Module({
  imports: [AuthModule],
  providers: [NotificationDeliveryService, NotificationWorkerService],
  exports: [NotificationDeliveryService],
})
export class AutomationModule {}

import { Module } from "@nestjs/common";
import { NotificationDeliveryService } from "./notification-delivery.service";
import { NotificationWorkerService } from "./notification-worker.service";

/**
 * automation.service.ts's notificationsFor*() functions stay plain,
 * dependency-free pure functions with no module of their own (every
 * controller that uses them imports the file directly) — this module exists
 * only for the two pieces that need real DI/lifecycle management: the
 * queue producer and the in-process worker. Exported so any controller that
 * computes a NotificationEvent can enqueue it for real.
 */
@Module({
  providers: [NotificationDeliveryService, NotificationWorkerService],
  exports: [NotificationDeliveryService],
})
export class AutomationModule {}

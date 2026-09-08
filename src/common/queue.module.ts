import { Global, Inject, Module, OnModuleDestroy } from "@nestjs/common";
import { Queue } from "bullmq";

export const NOTIFICATION_QUEUE = Symbol("NOTIFICATION_QUEUE");
export const NOTIFICATION_QUEUE_NAME = "notifications";

/**
 * Master Plan Section 4 names Redis/BullMQ specifically for this — the
 * Automation & Notification Engine's job queue. Unlike jwt.ts/totp.ts/
 * password.ts (hand-rolled deliberately, see package.json's own note), a job
 * queue with real retry/backoff semantics has no reasonable hand-rolled
 * substitute, so `bullmq` is a genuine new dependency here.
 *
 * Same DATABASE_URL-gated pattern as DatabaseModule: when REDIS_URL is
 * unset, this provides `null` — NotificationDeliveryService.enqueue() below
 * already no-ops in that case, so the app boots and every existing endpoint
 * works exactly as before with zero configuration, and switches to a real
 * queue the moment REDIS_URL is set.
 */
@Global()
@Module({
  providers: [
    {
      provide: NOTIFICATION_QUEUE,
      useFactory: (): Queue | null =>
        process.env.REDIS_URL ? new Queue(NOTIFICATION_QUEUE_NAME, { connection: { url: process.env.REDIS_URL } }) : null,
    },
  ],
  exports: [NOTIFICATION_QUEUE],
})
export class QueueModule implements OnModuleDestroy {
  constructor(@Inject(NOTIFICATION_QUEUE) private readonly queue: Queue | null) {}

  async onModuleDestroy(): Promise<void> {
    // Same reasoning as DatabaseModule's onModuleDestroy: without this,
    // Jest (and a real process) leaks the queue's open Redis connection.
    await this.queue?.close();
  }
}

import { Inject, Injectable } from "@nestjs/common";
import { Queue } from "bullmq";
import { NOTIFICATION_QUEUE } from "../../common/queue.module";
import { NotificationEvent } from "./automation.service";

/**
 * Closes a real gap every controller that computes NotificationEvents used
 * to carry inline: automation.service.ts's notificationsFor*() functions
 * decide WHETHER and WHAT to notify, correctly, but nothing ever DID
 * anything with the result beyond returning it in the HTTP response — no
 * background delivery mechanism existed at all (Master Plan Section 4's
 * Redis/BullMQ requirement, previously entirely unbuilt).
 *
 * This is deliberately still not "send a WhatsApp message" — see
 * NotificationWorkerService for why the actual delivery attempt still fails
 * every time (WhatsApp Business API is still "Assumed" per Master Plan
 * Section 8, unconfirmed cost/access route/rate limits). What this closes
 * is the queue infrastructure itself: a NotificationEvent computed by a
 * controller now genuinely reaches a real background job, processed by a
 * real worker, outside the request/response cycle — the exact mechanism
 * Section 4 calls for, proven with a real Redis-compatible server, not
 * simulated.
 */
@Injectable()
export class NotificationDeliveryService {
  constructor(@Inject(NOTIFICATION_QUEUE) private readonly queue: Queue | null) {}

  /**
   * No-ops when REDIS_URL is unset (queue is null) — exactly like every
   * other DATABASE_URL-gated store falls back to an in-memory no-op
   * equivalent. A caller does not need to check whether a queue exists
   * first; enqueuing when there is nowhere to enqueue to is simply not an
   * error, the same way saving to an in-memory store when Postgres isn't
   * configured isn't an error either.
   */
  async enqueue(notifications: NotificationEvent[]): Promise<void> {
    if (!this.queue || notifications.length === 0) return;
    await Promise.all(notifications.map((event) => this.queue!.add(event.type, event, { attempts: 1 })));
  }
}

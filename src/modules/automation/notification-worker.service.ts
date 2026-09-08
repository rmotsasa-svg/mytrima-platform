import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Job, Worker } from "bullmq";
import { NOTIFICATION_QUEUE_NAME } from "../../common/queue.module";
import { NotificationEvent } from "./automation.service";
import { NotYetVerifiedWhatsAppService, WhatsAppService } from "../integrations/whatsapp/whatsapp.service";

/**
 * Extracted as a standalone function (not just a private class method) so a
 * test can construct a real BullMQ `Worker` against it directly, against a
 * real, disposable, uniquely-named test queue — proving the actual
 * enqueue → real-Redis → worker-picks-it-up → processor-runs pipeline, not
 * a mock standing in for any part of it. See notification-worker.service.test.ts.
 *
 * There is no confirmed WhatsApp template name or parameter scheme to
 * compose a real message against — WhatsApp integration itself was never
 * confirmed, so inventing one here would be guessing at a vendor contract
 * that doesn't exist yet. This calls the real client interface with the
 * notification's own message as a placeholder body, which is enough to
 * prove a job reaches real delivery-attempt code; it is expected to throw
 * PendingVerificationError every time until that vendor decision is
 * actually resolved.
 */
export async function deliverNotification(event: NotificationEvent, whatsapp: WhatsAppService = new NotYetVerifiedWhatsAppService()): Promise<void> {
  await whatsapp.sendTemplateMessage("", "mytrima_notification", [event.message]);
}

/**
 * The actual background worker Master Plan Section 4's Redis/BullMQ
 * requirement calls for — runs in-process via BullMQ's own `Worker` (no
 * separate worker process/deployment exists for this pilot-scale scaffold;
 * Master Plan Section 2's own "right-size before scale" principle is
 * exactly the case for not standing up a separate worker fleet yet).
 *
 * KNOWN, DELIBERATE OUTCOME: every job this worker processes currently
 * fails, on purpose. `attemptDelivery()` calls the real WhatsApp client
 * interface, which is still `NotYetVerifiedWhatsAppService` — WhatsApp
 * Business API is "Assumed" per Master Plan Section 8, with access route,
 * cost, and template-approval turnaround still unconfirmed with Meta/a BSP.
 * There is also no confirmed template name/params scheme to compose a real
 * message against, since the integration itself was never confirmed. A job
 * failing with a clear `PendingVerificationError` reason is the accurate
 * outcome, not a bug to paper over — the same "fail loudly instead of a
 * fake success" principle every other integration stub in this codebase
 * already follows. What this worker proves is real: a job enqueued by
 * NotificationDeliveryService genuinely flows through Redis and reaches
 * real delivery-attempt code, outside the HTTP request/response cycle,
 * exactly the mechanism Section 4 asks for. The last mile — an actual
 * message reaching a customer's phone — is blocked on the vendor decision,
 * not on this queue.
 */
@Injectable()
export class NotificationWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NotificationWorkerService.name);
  private worker: Worker<NotificationEvent> | null = null;

  onModuleInit(): void {
    if (!process.env.REDIS_URL) return;
    this.worker = new Worker<NotificationEvent>(NOTIFICATION_QUEUE_NAME, (job: Job<NotificationEvent>) => deliverNotification(job.data), {
      connection: { url: process.env.REDIS_URL },
    });
    this.worker.on("failed", (job, err) => {
      this.logger.warn(`Notification job ${job?.id} (${job?.name}) failed: ${err.message}`);
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
  }
}

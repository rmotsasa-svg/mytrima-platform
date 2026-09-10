import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Job, Worker } from "bullmq";
import { NOTIFICATION_QUEUE_NAME } from "../../common/queue.module";
import { NotificationEvent } from "./automation.service";
import { NotYetVerifiedWhatsAppService, WhatsAppCloudApiService, WhatsAppService } from "../integrations/whatsapp/whatsapp.service";
import { TenantStore } from "../auth/tenant.service";
import { TENANT_STORE } from "../auth/tenant.tokens";

export class NotificationPhoneNotConfiguredError extends Error {
  constructor(tenantId: string) {
    super(
      `Tenant "${tenantId}" has no notification phone number configured — set one via PATCH /auth/tenants/notification-phone before WhatsApp delivery can succeed`
    );
    this.name = "NotificationPhoneNotConfiguredError";
  }
}

/** Same env-var-presence fallback pattern as DatabaseModule/QueueModule:
 * falls back to the honest not-yet-verified stub when WHATSAPP_PHONE_NUMBER_ID/
 * WHATSAPP_ACCESS_TOKEN aren't set, rather than requiring them just to boot. */
function createWhatsAppService(): WhatsAppService {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  return phoneNumberId && accessToken ? new WhatsAppCloudApiService(phoneNumberId, accessToken) : new NotYetVerifiedWhatsAppService();
}

/**
 * Extracted as a standalone function (not just a private class method) so a
 * test can construct a real BullMQ `Worker` against it directly, against a
 * real, disposable, uniquely-named test queue — proving the actual
 * enqueue → real-Redis → worker-picks-it-up → processor-runs pipeline, not
 * a mock standing in for any part of it. See notification-worker.service.test.ts.
 *
 * UPGRADED 2026-09-10: WhatsApp Business API moved from "Assumed" to a real
 * client (see whatsapp.service.ts) — but this function's first real
 * decision is still WHO to send to, which `NotificationEvent` alone never
 * carried (see automation.service.ts's own comment: it's about a customer,
 * addressed to tenant staff — there was nowhere above `customer` to even
 * store a staff phone number until migration 0014). `tenantStore.findById()`
 * resolves the tenant's own notification phone; a tenant that hasn't set one
 * fails loudly with `NotificationPhoneNotConfiguredError`, the same
 * "fail loudly instead of a fake success" discipline `PendingVerificationError`
 * already established, rather than silently guessing a recipient or
 * dropping the job.
 *
 * There is still no confirmed, approved, business-specific WhatsApp template
 * to actually carry `event.message` — Meta requires template approval before
 * a business-initiated message can use one outside a customer-initiated
 * 24-hour window (see whatsapp.service.ts), and no such template has been
 * submitted. This calls the real client with `hello_world`, Meta's own
 * pre-approved sample template every WhatsApp number gets automatically —
 * enough to prove a job genuinely reaches a real WhatsApp send with no
 * manually-pasted token anywhere, but it cannot actually carry
 * `event.message`'s real content (hello_world takes no parameters) until a
 * real template is submitted and approved. Documented here rather than
 * quietly pretending the notification's real content is delivered.
 */
export async function deliverNotification(
  event: NotificationEvent,
  tenantStore: TenantStore,
  whatsapp: WhatsAppService = createWhatsAppService()
): Promise<void> {
  const tenant = await tenantStore.findById(event.tenantId);
  if (!tenant?.notificationPhoneE164) throw new NotificationPhoneNotConfiguredError(event.tenantId);
  await whatsapp.sendTemplateMessage(tenant.notificationPhoneE164, "hello_world", []);
}

/**
 * The actual background worker Master Plan Section 4's Redis/BullMQ
 * requirement calls for — runs in-process via BullMQ's own `Worker` (no
 * separate worker process/deployment exists for this pilot-scale scaffold;
 * Master Plan Section 2's own "right-size before scale" principle is
 * exactly the case for not standing up a separate worker fleet yet).
 *
 * A job now genuinely SUCCEEDS when both WHATSAPP_PHONE_NUMBER_ID/
 * WHATSAPP_ACCESS_TOKEN are configured and the tenant has set a
 * notification phone — see deliverNotification()'s own comment for exactly
 * what "succeeds" still means (hello_world, not the real message content)
 * and what remains genuinely blocked (a real approved template).
 */
@Injectable()
export class NotificationWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NotificationWorkerService.name);
  private worker: Worker<NotificationEvent> | null = null;

  constructor(@Inject(TENANT_STORE) private readonly tenantStore: TenantStore) {}

  onModuleInit(): void {
    if (!process.env.REDIS_URL) return;
    this.worker = new Worker<NotificationEvent>(
      NOTIFICATION_QUEUE_NAME,
      (job: Job<NotificationEvent>) => deliverNotification(job.data, this.tenantStore),
      { connection: { url: process.env.REDIS_URL } }
    );
    this.worker.on("failed", (job, err) => {
      this.logger.warn(`Notification job ${job?.id} (${job?.name}) failed: ${err.message}`);
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
  }
}

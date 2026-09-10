import { Queue, Worker, Job } from "bullmq";
import { deliverNotification, NotificationPhoneNotConfiguredError } from "./notification-worker.service";
import { NotificationDeliveryService } from "./notification-delivery.service";
import { NotificationEvent } from "./automation.service";
import { PendingVerificationError } from "../integrations/pending-integration";
import { TenantRecord, TenantStore } from "../auth/tenant.service";

/** A minimal fake TenantStore — deliverNotification only ever calls
 * findById(), so that's the only method these tests need to stand in for. */
function fakeTenantStore(phoneE164: string | null): TenantStore {
  const record: TenantRecord | null = phoneE164 ? { id: "t1", name: "Test Tenant", notificationPhoneE164: phoneE164 } : null;
  return {
    create: async () => {},
    findById: async () => record,
    updateNotificationPhone: async () => {},
  };
}

test("deliverNotification throws NotificationPhoneNotConfiguredError when the tenant has no notification phone set", async () => {
  await expect(
    deliverNotification({ tenantId: "t1", type: "nps_detractor_followup", message: "hi", priority: "urgent" }, fakeTenantStore(null))
  ).rejects.toThrow(NotificationPhoneNotConfiguredError);
});

test("deliverNotification falls back to the not-yet-verified WhatsApp client and surfaces PendingVerificationError when no real one is injected (WHATSAPP_PHONE_NUMBER_ID/WHATSAPP_ACCESS_TOKEN unset in this test run)", async () => {
  await expect(
    deliverNotification(
      { tenantId: "t1", type: "nps_detractor_followup", message: "hi", priority: "urgent" },
      fakeTenantStore("+26612345678")
    )
  ).rejects.toThrow(PendingVerificationError);
});

test("deliverNotification uses an injected client instead of the real one when given one — proves it's a real call, not a no-op", async () => {
  const fakeWhatsApp = { sendTemplateMessage: jest.fn().mockResolvedValue({ messageId: "m1" }), sendFreeformReply: jest.fn() };
  await deliverNotification(
    { tenantId: "t1", type: "nps_detractor_followup", message: "hello there", priority: "urgent" },
    fakeTenantStore("+26612345678"),
    fakeWhatsApp
  );
  // hello_world (Meta's own pre-approved sample template) takes no
  // parameters — see notification-worker.service.ts's own comment on why
  // event.message's real content isn't what gets sent yet.
  expect(fakeWhatsApp.sendTemplateMessage).toHaveBeenCalledWith("+26612345678", "hello_world", []);
});

/**
 * REAL integration test against a live Redis-compatible server — gated
 * behind TEST_REDIS_URL. This is the actual end-to-end proof Master Plan
 * Section 4's Redis/BullMQ requirement is for: a notification computed by a
 * controller reaches a real background job, genuinely processed by a real
 * worker outside the request/response cycle — not a mock standing in for
 * any part of the pipeline. The job is EXPECTED to fail in this test (no
 * WHATSAPP_PHONE_NUMBER_ID/WHATSAPP_ACCESS_TOKEN set in this test run) —
 * this proves it fails for the right, honest reason (falls back to
 * NotYetVerifiedWhatsAppService), not that it silently succeeds or
 * silently vanishes. See whatsapp.service.test.ts and
 * notification-worker.service.ts's own comment for the real client that
 * DOES succeed when those env vars are set.
 */
const TEST_REDIS_URL = process.env.TEST_REDIS_URL;
const maybeDescribe = TEST_REDIS_URL ? describe : describe.skip;

maybeDescribe("The real enqueue -> Redis -> worker -> processor pipeline against a live Redis-compatible server", () => {
  const queueName = `test-notification-worker-${Date.now()}`;
  let queue: Queue;
  let worker: Worker<NotificationEvent>;

  beforeAll(() => {
    queue = new Queue(queueName, { connection: { url: TEST_REDIS_URL } });
    worker = new Worker<NotificationEvent>(queueName, (job: Job<NotificationEvent>) => deliverNotification(job.data, fakeTenantStore("+26612345678")), {
      connection: { url: TEST_REDIS_URL },
    });
  });

  afterAll(async () => {
    await worker.close();
    await queue.obliterate({ force: true });
    await queue.close();
  });

  test("a job enqueued for real is genuinely picked up by a real worker and fails with the expected reason", async () => {
    const delivery = new NotificationDeliveryService(queue);
    const event: NotificationEvent = {
      tenantId: "t1",
      type: "rating_hidden_after_moderation",
      aboutCustomerId: "c1",
      message: "Real pipeline test",
      priority: "normal",
    };
    await delivery.enqueue([event]);

    // Poll for the job to reach a terminal state — genuinely waiting on the
    // real worker to pick it up and process it, not asserting immediately.
    const failedJob = await new Promise<Job>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Timed out waiting for the real worker to process the job")), 10000);
      worker.on("failed", (job) => {
        if (job && job.name === "rating_hidden_after_moderation") {
          clearTimeout(timeout);
          resolve(job);
        }
      });
    });

    expect(failedJob.failedReason).toContain("WhatsApp Business API is not implemented");
    expect(failedJob.data).toEqual(event);
  }, 15000);
});

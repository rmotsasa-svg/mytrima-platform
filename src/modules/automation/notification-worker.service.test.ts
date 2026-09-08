import { Queue, Worker, Job } from "bullmq";
import { deliverNotification } from "./notification-worker.service";
import { NotificationDeliveryService } from "./notification-delivery.service";
import { NotificationEvent } from "./automation.service";
import { PendingVerificationError } from "../integrations/pending-integration";

test("deliverNotification calls the real WhatsApp client interface and surfaces its PendingVerificationError", async () => {
  await expect(deliverNotification({ tenantId: "t1", type: "nps_detractor_followup", message: "hi", priority: "urgent" })).rejects.toThrow(
    PendingVerificationError
  );
});

test("deliverNotification uses an injected client instead of the real one when given one — proves it's a real call, not a no-op", async () => {
  const fakeWhatsApp = { sendTemplateMessage: jest.fn().mockResolvedValue({ messageId: "m1" }), sendFreeformReply: jest.fn() };
  await deliverNotification({ tenantId: "t1", type: "nps_detractor_followup", message: "hello there", priority: "urgent" }, fakeWhatsApp);
  expect(fakeWhatsApp.sendTemplateMessage).toHaveBeenCalledWith("", "mytrima_notification", ["hello there"]);
});

/**
 * REAL integration test against a live Redis-compatible server — gated
 * behind TEST_REDIS_URL. This is the actual end-to-end proof Master Plan
 * Section 4's Redis/BullMQ requirement is for: a notification computed by a
 * controller reaches a real background job, genuinely processed by a real
 * worker outside the request/response cycle — not a mock standing in for
 * any part of the pipeline. The job is EXPECTED to fail (see
 * notification-worker.service.ts's own comment on why) — this test proves
 * it fails for the right, honest reason (WhatsApp still unconfirmed), not
 * that it silently succeeds or silently vanishes.
 */
const TEST_REDIS_URL = process.env.TEST_REDIS_URL;
const maybeDescribe = TEST_REDIS_URL ? describe : describe.skip;

maybeDescribe("The real enqueue -> Redis -> worker -> processor pipeline against a live Redis-compatible server", () => {
  const queueName = `test-notification-worker-${Date.now()}`;
  let queue: Queue;
  let worker: Worker<NotificationEvent>;

  beforeAll(() => {
    queue = new Queue(queueName, { connection: { url: TEST_REDIS_URL } });
    worker = new Worker<NotificationEvent>(queueName, (job: Job<NotificationEvent>) => deliverNotification(job.data), {
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

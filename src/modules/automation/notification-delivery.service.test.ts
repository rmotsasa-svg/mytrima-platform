import { Queue } from "bullmq";
import { NotificationDeliveryService } from "./notification-delivery.service";
import { NotificationEvent } from "./automation.service";

const sampleEvent: NotificationEvent = {
  tenantId: "t1",
  type: "rating_hidden_after_moderation",
  aboutCustomerId: "c1",
  message: "A rating was hidden after moderation",
  priority: "normal",
};

test("enqueue no-ops when there is no queue (REDIS_URL unset) — never throws", async () => {
  const service = new NotificationDeliveryService(null);
  await expect(service.enqueue([sampleEvent])).resolves.toBeUndefined();
});

test("enqueue never calls the queue for an empty array, even with a real queue configured", async () => {
  const fakeQueue = { add: jest.fn() } as unknown as Queue;
  const service = new NotificationDeliveryService(fakeQueue);
  await service.enqueue([]);
  expect(fakeQueue.add).not.toHaveBeenCalled();
});

test("enqueue adds one job per notification, named by its type", async () => {
  const fakeQueue = { add: jest.fn().mockResolvedValue(undefined) } as unknown as Queue;
  const service = new NotificationDeliveryService(fakeQueue);
  const second: NotificationEvent = { ...sampleEvent, type: "nps_detractor_followup" };
  await service.enqueue([sampleEvent, second]);
  expect(fakeQueue.add).toHaveBeenCalledTimes(2);
  expect(fakeQueue.add).toHaveBeenCalledWith("rating_hidden_after_moderation", sampleEvent, { attempts: 1 });
  expect(fakeQueue.add).toHaveBeenCalledWith("nps_detractor_followup", second, { attempts: 1 });
});

/**
 * REAL integration test against a live Redis-compatible server — gated
 * behind TEST_REDIS_URL. Confirmed against Memurai (a Redis-protocol-
 * compatible Windows-native server already present on this machine) at
 * redis://127.0.0.1:6379.
 */
const TEST_REDIS_URL = process.env.TEST_REDIS_URL;
const maybeDescribe = TEST_REDIS_URL ? describe : describe.skip;

maybeDescribe("NotificationDeliveryService against a real Redis-compatible server", () => {
  const queueName = `test-notification-delivery-${Date.now()}`;
  const queue = new Queue(queueName, { connection: { url: TEST_REDIS_URL } });
  const service = new NotificationDeliveryService(queue);

  afterAll(async () => {
    await queue.obliterate({ force: true });
    await queue.close();
  });

  test("enqueue genuinely adds a real job to Redis, not just an in-memory call", async () => {
    await service.enqueue([sampleEvent]);
    const counts = await queue.getJobCounts("waiting", "active", "completed", "failed", "delayed");
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    expect(total).toBeGreaterThanOrEqual(1);

    const jobs = await queue.getJobs(["waiting", "active", "completed", "failed", "delayed"]);
    const found = jobs.find((j) => j.name === "rating_hidden_after_moderation");
    expect(found?.data).toEqual(sampleEvent);
  });
});

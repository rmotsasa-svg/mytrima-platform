import { randomUUID } from "node:crypto";
import { SocialPostLogService } from "./social-post-log.service";
import { InMemorySocialPostLogStore } from "./in-memory-social-post-log.store";

test("hasPostedRecently is false when a tenant has never posted", async () => {
  const service = new SocialPostLogService(new InMemorySocialPostLogStore());
  expect(await service.hasPostedRecently("t1", 30)).toBe(false);
});

test("hasPostedRecently is true after a real post is recorded within the window", async () => {
  const service = new SocialPostLogService(new InMemorySocialPostLogStore());
  await service.record({ id: randomUUID(), tenantId: "t1", provider: "facebook", postId: "123_456", postedAt: new Date() });
  expect(await service.hasPostedRecently("t1", 30)).toBe(true);
});

test("hasPostedRecently is false when the only post is older than the window", async () => {
  const service = new SocialPostLogService(new InMemorySocialPostLogStore());
  const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
  await service.record({ id: randomUUID(), tenantId: "t1", provider: "facebook", postId: "123_456", postedAt: sixtyDaysAgo });
  expect(await service.hasPostedRecently("t1", 30)).toBe(false);
});

test("is tenant-scoped", async () => {
  const service = new SocialPostLogService(new InMemorySocialPostLogStore());
  await service.record({ id: randomUUID(), tenantId: "t2", provider: "instagram", postId: "789", postedAt: new Date() });
  expect(await service.hasPostedRecently("t1", 30)).toBe(false);
});

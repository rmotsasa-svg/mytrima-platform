import { SocialConnectionService, SocialConnectionNotFoundError, SocialConnection } from "./social-connection.service";
import { InMemorySocialConnectionStore } from "./in-memory-social-connection.store";

function makeConnection(overrides: Partial<SocialConnection> = {}): SocialConnection {
  return {
    id: "c1",
    tenantId: "t1",
    provider: "facebook",
    pageId: "123456789",
    pageName: "Test Page",
    pageAccessToken: "real-page-token",
    instagramAccountId: null,
    connectedAt: new Date(),
    ...overrides,
  };
}

test("getForTenant returns null when no connection exists", async () => {
  const service = new SocialConnectionService(new InMemorySocialConnectionStore());
  expect(await service.getForTenant("t1")).toBeNull();
});

test("save then getForTenant returns the real connection", async () => {
  const service = new SocialConnectionService(new InMemorySocialConnectionStore());
  await service.save(makeConnection());
  const connection = await service.getForTenant("t1");
  expect(connection?.pageId).toBe("123456789");
  expect(connection?.pageName).toBe("Test Page");
});

test("getForTenant is tenant-scoped", async () => {
  const service = new SocialConnectionService(new InMemorySocialConnectionStore());
  await service.save(makeConnection({ tenantId: "t1" }));
  await service.save(makeConnection({ tenantId: "t2", pageName: "Other tenant's Page" }));
  const connection = await service.getForTenant("t1");
  expect(connection?.pageName).toBe("Test Page");
});

test("requireForTenant throws SocialConnectionNotFoundError when no connection exists", async () => {
  const service = new SocialConnectionService(new InMemorySocialConnectionStore());
  await expect(service.requireForTenant("t1")).rejects.toThrow(SocialConnectionNotFoundError);
});

test("requireForTenant returns the connection when one exists", async () => {
  const service = new SocialConnectionService(new InMemorySocialConnectionStore());
  await service.save(makeConnection());
  const connection = await service.requireForTenant("t1");
  expect(connection.pageId).toBe("123456789");
});

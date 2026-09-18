import { randomUUID } from "node:crypto";
import { AuditLogService } from "./audit-log.service";
import { InMemoryAuditLogStore } from "./in-memory-audit-log.store";

function makeService() {
  return new AuditLogService(new InMemoryAuditLogStore());
}

test("recordAdminAction with no tenantId writes a real platform-level entry (tenantId null, actorUserId null, the admin id in metadata)", async () => {
  const service = makeService();
  const adminId = randomUUID();
  await service.recordAdminAction("admin.create", "admin_user", "new-admin-id", adminId);

  const platform = await service.listPlatformLevel();
  expect(platform).toHaveLength(1);
  expect(platform[0]).toMatchObject({
    tenantId: null,
    actorUserId: null,
    action: "admin.create",
    entityTable: "admin_user",
    entityId: "new-admin-id",
    metadata: { actorAdminId: adminId },
  });
});

test("recordAdminAction with a tenantId writes a real tenant-scoped entry, never surfaced by listPlatformLevel", async () => {
  const service = makeService();
  const adminId = randomUUID();
  const tenantId = randomUUID();
  await service.recordAdminAction("tenant.suspend", "tenant", tenantId, adminId, tenantId);

  await expect(service.listPlatformLevel()).resolves.toEqual([]);
  const forTenant = await service.listForTenant(tenantId);
  expect(forTenant).toHaveLength(1);
  expect(forTenant[0]).toMatchObject({ tenantId, action: "tenant.suspend", metadata: { actorAdminId: adminId } });
});

test("listForTenant never returns another tenant's entries", async () => {
  const service = makeService();
  const adminId = randomUUID();
  const tenantA = randomUUID();
  const tenantB = randomUUID();
  await service.recordAdminAction("tenant.suspend", "tenant", tenantA, adminId, tenantA);
  await service.recordAdminAction("tenant.reactivate", "tenant", tenantB, adminId, tenantB);

  const forA = await service.listForTenant(tenantA);
  expect(forA).toHaveLength(1);
  expect(forA[0].tenantId).toBe(tenantA);
});

test("listForTenant returns entries most-recent-first, by real insertion order, not a timestamp comparison that can tie", async () => {
  const service = makeService();
  const adminId = randomUUID();
  const tenantId = randomUUID();
  await service.recordAdminAction("tenant.suspend", "tenant", tenantId, adminId, tenantId);
  await service.recordAdminAction("tenant.reactivate", "tenant", tenantId, adminId, tenantId);
  await service.recordAdminAction("tenant.custom_price.set", "tenant", tenantId, adminId, tenantId);

  const entries = await service.listForTenant(tenantId);
  expect(entries.map((e) => e.action)).toEqual(["tenant.custom_price.set", "tenant.reactivate", "tenant.suspend"]);
});

test("a tenant with no admin actions ever taken against it has a real, empty audit log — not undefined", async () => {
  const service = makeService();
  await expect(service.listForTenant(randomUUID())).resolves.toEqual([]);
});

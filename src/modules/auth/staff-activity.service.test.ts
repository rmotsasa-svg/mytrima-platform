import { StaffActivityLogService } from "./staff-activity.service";
import { InMemoryStaffActivityLogStore } from "./in-memory-staff-activity-log.store";

function makeService(): StaffActivityLogService {
  return new StaffActivityLogService(new InMemoryStaffActivityLogStore());
}

test("record then listForTenant returns the real entry with its real details", async () => {
  const service = makeService();
  await service.record({
    id: "e1",
    tenantId: "t1",
    userId: "u1",
    action: "petty_cash.replenish",
    details: { amount: 500 },
    occurredAt: new Date("2026-09-14T10:00:00Z"),
  });
  const entries = await service.listForTenant("t1");
  expect(entries).toHaveLength(1);
  expect(entries[0].action).toBe("petty_cash.replenish");
  expect(entries[0].details).toEqual({ amount: 500 });
});

test("listForTenant only ever returns entries for that tenant, never another tenant's", async () => {
  const service = makeService();
  await service.record({ id: "e1", tenantId: "t1", userId: "u1", action: "sale.recorded", occurredAt: new Date() });
  await service.record({ id: "e2", tenantId: "t2", userId: "u2", action: "sale.recorded", occurredAt: new Date() });
  const entries = await service.listForTenant("t1");
  expect(entries.map((e) => e.id)).toEqual(["e1"]);
});

test("listForTenant with a userId narrows to that one staff member's own history", async () => {
  const service = makeService();
  await service.record({ id: "e1", tenantId: "t1", userId: "u1", action: "sale.recorded", occurredAt: new Date() });
  await service.record({ id: "e2", tenantId: "t1", userId: "u2", action: "sale.recorded", occurredAt: new Date() });
  const entries = await service.listForTenant("t1", "u2");
  expect(entries.map((e) => e.id)).toEqual(["e2"]);
});

test("listForTenant orders newest first", async () => {
  const service = makeService();
  await service.record({ id: "older", tenantId: "t1", userId: "u1", action: "sale.recorded", occurredAt: new Date("2026-09-10T00:00:00Z") });
  await service.record({ id: "newer", tenantId: "t1", userId: "u1", action: "sale.refund", occurredAt: new Date("2026-09-14T00:00:00Z") });
  const entries = await service.listForTenant("t1");
  expect(entries.map((e) => e.id)).toEqual(["newer", "older"]);
});

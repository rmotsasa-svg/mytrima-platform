import { TriggerService, TriggerNotFoundError } from "./trigger.service";
import { InMemoryTriggerStore } from "./in-memory-trigger.store";
import { NotificationEvent } from "../automation/automation.service";
import { GrowthActionService } from "../growth-actions/growth-action.service";
import { InMemoryGrowthActionStore } from "../growth-actions/in-memory-growth-action.store";
import { GoalService } from "../goals/goal.service";
import { InMemoryGoalStore } from "../goals/in-memory-goal.store";

function makeService() {
  return new TriggerService(new InMemoryTriggerStore(), new GrowthActionService(new InMemoryGrowthActionStore(), new GoalService(new InMemoryGoalStore())));
}

const criticalAuditEvent: NotificationEvent = {
  tenantId: "t1",
  type: "growth_audit_critical_band",
  message: "Growth Audit scored 32/100 (Critical) — several core business fundamentals need attention.",
  priority: "urgent",
};

const weakAuditEvent: NotificationEvent = {
  tenantId: "t1",
  type: "growth_audit_weak_band",
  message: "Growth Audit scored 55/100 (Weak).",
  priority: "normal",
};

test("record() persists a real Trigger per event, mapping urgent -> critical and normal -> warning severity", async () => {
  const service = makeService();
  const created = await service.record("t1", [criticalAuditEvent, weakAuditEvent]);
  expect(created).toHaveLength(2);
  expect(created[0]).toMatchObject({ severity: "critical", status: "open", sourceModule: "growth_audit", message: criticalAuditEvent.message });
  expect(created[1]).toMatchObject({ severity: "warning", status: "open", sourceModule: "growth_audit", message: weakAuditEvent.message });
});

test("record() with an empty array is a real no-op, not an error", async () => {
  const service = makeService();
  const created = await service.record("t1", []);
  expect(created).toEqual([]);
  expect(await service.listForTenant("t1")).toEqual([]);
});

test("listForTenant() never returns another tenant's triggers", async () => {
  const service = makeService();
  await service.record("t1", [criticalAuditEvent]);
  await service.record("t2", [criticalAuditEvent]);
  const t1Triggers = await service.listForTenant("t1");
  expect(t1Triggers).toHaveLength(1);
  expect(t1Triggers[0].tenantId).toBe("t1");
});

test("listForTenant(tenantId, status) filters by status", async () => {
  const service = makeService();
  const [open] = await service.record("t1", [criticalAuditEvent]);
  await service.dismiss("t1", open.id);
  expect(await service.listForTenant("t1", "open")).toHaveLength(0);
  expect(await service.listForTenant("t1", "dismissed")).toHaveLength(1);
});

test("dismiss() on a real trigger sets status to dismissed", async () => {
  const service = makeService();
  const [created] = await service.record("t1", [criticalAuditEvent]);
  const dismissed = await service.dismiss("t1", created.id);
  expect(dismissed.status).toBe("dismissed");
});

test("dismiss() is idempotent — dismissing an already-dismissed trigger succeeds again rather than throwing", async () => {
  const service = makeService();
  const [created] = await service.record("t1", [criticalAuditEvent]);
  await service.dismiss("t1", created.id);
  await expect(service.dismiss("t1", created.id)).resolves.toMatchObject({ status: "dismissed" });
});

test("dismiss() on a nonexistent id throws TriggerNotFoundError", async () => {
  const service = makeService();
  await expect(service.dismiss("t1", "no-such-id")).rejects.toThrow(TriggerNotFoundError);
});

test("convertToAction() sets status to actioned, stamps actionedAt, and creates a real linked GrowthAction", async () => {
  const service = makeService();
  const [created] = await service.record("t1", [criticalAuditEvent]);
  const { trigger, growthAction } = await service.convertToAction("t1", created.id);
  expect(trigger.status).toBe("actioned");
  expect(trigger.actionedAt).toBeInstanceOf(Date);
  expect(growthAction.relatedTriggerId).toBe(created.id);
  expect(growthAction.title).toBe(criticalAuditEvent.message);
  expect(growthAction.priority).toBe("high"); // critical severity -> high priority
  expect(growthAction.status).toBe("todo");
});

import { GrowthActionService, InvalidGrowthActionError, GrowthActionNotFoundError } from "./growth-action.service";
import { InMemoryGrowthActionStore } from "./in-memory-growth-action.store";
import { GoalService } from "../goals/goal.service";
import { InMemoryGoalStore } from "../goals/in-memory-goal.store";
import { Trigger } from "../triggers/trigger.service";

function makeService() {
  const goalService = new GoalService(new InMemoryGoalStore());
  const growthActionService = new GrowthActionService(new InMemoryGrowthActionStore(), goalService);
  return { growthActionService, goalService };
}

function baseGoalInput(overrides: Partial<Parameters<GoalService["create"]>[2]> = {}) {
  return {
    objective: "Increase monthly revenue",
    metric: "Monthly revenue (LSL)",
    baselineValue: 0,
    targetValue: 100,
    deadline: new Date("2099-12-31"),
    priority: "high" as const,
    ...overrides,
  };
}

function baseTrigger(overrides: Partial<Trigger>): Trigger {
  return {
    id: "trig1",
    tenantId: "t1",
    type: "growth_audit_critical_band",
    severity: "critical",
    message: "Growth Audit scored 0/100 (Critical) — several core business fundamentals need attention.",
    sourceModule: "growth_audit",
    createdAt: new Date(),
    status: "open",
    ...overrides,
  };
}

test("create persists a growth action with status todo", async () => {
  const { growthActionService: service } = makeService();
  const action = await service.create("t1", "a1", {
    title: "Follow up with 5 hot leads",
    reason: "5 qualified leads haven't been contacted",
    priority: "high",
    expectedImpact: "Revenue",
  });
  expect(action.status).toBe("todo");
  expect(action.title).toBe("Follow up with 5 hot leads");
});

test("create rejects an empty title", async () => {
  const { growthActionService: service } = makeService();
  await expect(service.create("t1", "a1", { title: "  ", reason: "x", priority: "low", expectedImpact: "y" })).rejects.toThrow(InvalidGrowthActionError);
});

test("createFromTrigger maps severity to priority and sourceModule to a real expectedImpact label", async () => {
  const { growthActionService: service } = makeService();
  const action = await service.createFromTrigger(baseTrigger({}), "a1");
  expect(action.priority).toBe("high");
  expect(action.expectedImpact).toBe("Business fundamentals");
  expect(action.relatedTriggerId).toBe("trig1");
  expect(action.title).toBe(baseTrigger({}).message);
  expect(action.status).toBe("todo");
});

test("createFromTrigger maps a warning-severity sales trigger to medium priority and Revenue impact", async () => {
  const { growthActionService: service } = makeService();
  const action = await service.createFromTrigger(
    baseTrigger({ id: "trig2", severity: "warning", sourceModule: "sales", message: "Conversion dropped 14%." }),
    "a2"
  );
  expect(action.priority).toBe("medium");
  expect(action.expectedImpact).toBe("Revenue");
});

test("update's real PATCH semantics: omitted fields keep their existing value, status/result are settable", async () => {
  const { growthActionService: service } = makeService();
  const created = await service.create("t1", "a1", { title: "x", reason: "y", priority: "low", expectedImpact: "z" });
  const updated = await service.update("t1", created.id, { status: "done", result: "Contacted 5 leads, 2 converted." });
  expect(updated.status).toBe("done");
  expect(updated.result).toBe("Contacted 5 leads, 2 converted.");
  expect(updated.title).toBe(created.title);
});

test("update on a nonexistent id throws GrowthActionNotFoundError", async () => {
  const { growthActionService: service } = makeService();
  await expect(service.update("t1", "no-such-id", { status: "done" })).rejects.toThrow(GrowthActionNotFoundError);
});

test("listForTenant(tenantId, status) filters by status and never crosses tenants", async () => {
  const { growthActionService: service } = makeService();
  await service.create("t1", "a1", { title: "x", reason: "y", priority: "low", expectedImpact: "z" });
  const other = await service.create("t1", "a2", { title: "x2", reason: "y2", priority: "low", expectedImpact: "z2" });
  await service.update("t1", other.id, { status: "done" });
  await service.create("t2", "a3", { title: "x3", reason: "y3", priority: "low", expectedImpact: "z3" });

  expect(await service.listForTenant("t1", "todo")).toHaveLength(1);
  expect(await service.listForTenant("t1", "done")).toHaveLength(1);
  expect(await service.listForTenant("t1")).toHaveLength(2);
});

test("createFromTrigger sets relatedGoalId when exactly one open goal shares the trigger's business area", async () => {
  const { growthActionService: service, goalService } = makeService();
  const revenueGoal = await goalService.create("t1", "goal1", baseGoalInput({ metricType: "sales_amount" }));
  const action = await service.createFromTrigger(baseTrigger({ sourceModule: "sales", severity: "warning", message: "Conversion dropped 14%." }), "a1");
  expect(action.relatedGoalId).toBe(revenueGoal.id);
});

test("createFromTrigger leaves relatedGoalId unset when zero goals match the trigger's business area", async () => {
  const { growthActionService: service } = makeService();
  const action = await service.createFromTrigger(baseTrigger({ sourceModule: "sales" }), "a1");
  expect(action.relatedGoalId).toBeUndefined();
});

test("createFromTrigger leaves relatedGoalId unset when multiple open goals match — never guesses among ambiguous matches", async () => {
  const { growthActionService: service, goalService } = makeService();
  await goalService.create("t1", "goal1", baseGoalInput({ metricType: "sales_amount" }));
  await goalService.create("t1", "goal2", baseGoalInput({ metricType: "conversion_rate" }));
  const action = await service.createFromTrigger(baseTrigger({ sourceModule: "sales" }), "a1");
  expect(action.relatedGoalId).toBeUndefined();
});

test("createFromTrigger ignores achieved/abandoned goals when matching — an already-closed goal is not a valid target", async () => {
  const { growthActionService: service, goalService } = makeService();
  const matching = await goalService.create("t1", "goal1", baseGoalInput({ metricType: "sales_amount" }));
  await goalService.update("t1", matching.id, { status: "achieved" });
  const other = await goalService.create("t1", "goal2", baseGoalInput({ metricType: "conversion_rate" }));
  const action = await service.createFromTrigger(baseTrigger({ sourceModule: "sales" }), "a1");
  expect(action.relatedGoalId).toBe(other.id);
});

test("createFromTrigger never matches a goal in another tenant", async () => {
  const { growthActionService: service, goalService } = makeService();
  await goalService.create("t2", "goal1", baseGoalInput({ metricType: "sales_amount" }));
  const action = await service.createFromTrigger(baseTrigger({ tenantId: "t1", sourceModule: "sales" }), "a1");
  expect(action.relatedGoalId).toBeUndefined();
});

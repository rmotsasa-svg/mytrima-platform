import { GoalService, InvalidGoalError, GoalNotFoundError, computeProgressPct, Goal } from "./goal.service";
import { InMemoryGoalStore } from "./in-memory-goal.store";

function makeService() {
  return new GoalService(new InMemoryGoalStore());
}

function baseGoal(overrides: Partial<Goal>): Goal {
  return {
    id: "g1",
    tenantId: "t1",
    objective: "Increase monthly revenue",
    metric: "Monthly revenue (LSL)",
    baselineValue: 48750,
    currentValue: 48750,
    targetValue: 70000,
    deadline: new Date("2026-12-31"),
    priority: "high",
    status: "on_track",
    createdAt: new Date(),
    ...overrides,
  };
}

test("create persists a goal with currentValue defaulting to baselineValue and status on_track", async () => {
  const service = makeService();
  const goal = await service.create("t1", "g1", {
    objective: "Increase monthly revenue",
    metric: "Monthly revenue (LSL)",
    baselineValue: 48750,
    targetValue: 70000,
    deadline: new Date("2026-12-31"),
    priority: "high",
  });
  expect(goal.currentValue).toBe(48750);
  expect(goal.status).toBe("on_track");
});

test("create rejects a targetValue equal to baselineValue", async () => {
  const service = makeService();
  await expect(
    service.create("t1", "g1", { objective: "x", metric: "y", baselineValue: 10, targetValue: 10, deadline: new Date(), priority: "low" })
  ).rejects.toThrow(InvalidGoalError);
});

test("create rejects an empty objective", async () => {
  const service = makeService();
  await expect(
    service.create("t1", "g1", { objective: "  ", metric: "y", baselineValue: 0, targetValue: 10, deadline: new Date(), priority: "low" })
  ).rejects.toThrow(InvalidGoalError);
});

test("update rejects a nonexistent id", async () => {
  const service = makeService();
  await expect(service.update("t1", "no-such-id", { currentValue: 5 })).rejects.toThrow(GoalNotFoundError);
});

test("update's real PATCH semantics: omitted fields keep their existing value", async () => {
  const service = makeService();
  const created = await service.create("t1", "g1", {
    objective: "Increase monthly revenue",
    metric: "Monthly revenue (LSL)",
    baselineValue: 48750,
    targetValue: 70000,
    deadline: new Date("2026-12-31"),
    priority: "high",
  });
  const updated = await service.update("t1", created.id, { currentValue: 60000 });
  expect(updated.currentValue).toBe(60000);
  expect(updated.objective).toBe(created.objective);
  expect(updated.targetValue).toBe(created.targetValue);
  expect(updated.priority).toBe(created.priority);
});

test("computeProgressPct: an increasing metric partway to target", () => {
  const goal = baseGoal({ baselineValue: 48750, currentValue: 60000, targetValue: 70000 });
  // (60000 - 48750) / (70000 - 48750) = 11250 / 21250 ≈ 52.94%
  expect(computeProgressPct(goal)).toBeCloseTo(52.94, 1);
});

test("computeProgressPct: a decreasing metric (e.g. churn) partway to target", () => {
  // Reduce churn from 10% to 5%, currently at 7%.
  const goal = baseGoal({ baselineValue: 10, currentValue: 7, targetValue: 5 });
  // (7 - 10) / (5 - 10) = -3 / -5 = 60%
  expect(computeProgressPct(goal)).toBeCloseTo(60, 5);
});

test("computeProgressPct clamps to 100 when currentValue overshoots the target", () => {
  const goal = baseGoal({ baselineValue: 48750, currentValue: 80000, targetValue: 70000 });
  expect(computeProgressPct(goal)).toBe(100);
});

test("computeProgressPct clamps to 0 when currentValue is still below baseline", () => {
  const goal = baseGoal({ baselineValue: 48750, currentValue: 40000, targetValue: 70000 });
  expect(computeProgressPct(goal)).toBe(0);
});

test("computeProgressPct is exactly 0 at baseline and exactly 100 at target", () => {
  const goal = baseGoal({ baselineValue: 48750, currentValue: 48750, targetValue: 70000 });
  expect(computeProgressPct(goal)).toBe(0);
  expect(computeProgressPct({ ...goal, currentValue: 70000 })).toBe(100);
});

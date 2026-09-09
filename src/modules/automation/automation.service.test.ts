import { notificationsForGrowthAudit, notificationsForNpsResponse, notificationsForModeratedRating, notificationsForKpiBenchmarkBreach } from "./automation.service";
import { scoreAudit, Answers } from "../growth-audit/growth-audit.service";
import { ALL_QUESTION_IDS } from "../growth-audit/questions.data";

function answersWithAll(value: number): Answers {
  const a: Answers = {};
  for (const id of ALL_QUESTION_IDS) a[id] = value;
  return a;
}

test("a Critical Growth Audit result produces one urgent notification", () => {
  const result = scoreAudit(answersWithAll(0)); // 0 -> Critical
  const events = notificationsForGrowthAudit("t1", result);
  expect(events.length).toBe(1);
  expect(events[0].type).toBe("growth_audit_critical_band");
  expect(events[0].priority).toBe("urgent");
  expect(events[0].tenantId).toBe("t1");
  expect(events[0].message).toMatch(/Critical/);
});

test("a KPI benchmark breach produces one normal-priority notification naming the KPI and both values", () => {
  const events = notificationsForKpiBenchmarkBreach("t1", "sales_amount", 1000, 5000, "below");
  expect(events.length).toBe(1);
  expect(events[0].type).toBe("kpi_benchmark_breach");
  expect(events[0].priority).toBe("normal");
  expect(events[0].tenantId).toBe("t1");
  expect(events[0].message).toMatch(/sales_amount/);
  expect(events[0].message).toMatch(/1000/);
  expect(events[0].message).toMatch(/5000/);
});

test("a Weak Growth Audit result produces one normal-priority notification", () => {
  const result = scoreAudit(answersWithAll(2)); // 2/4 uniform -> 50 -> Weak
  const events = notificationsForGrowthAudit("t1", result);
  expect(events.length).toBe(1);
  expect(events[0].type).toBe("growth_audit_weak_band");
  expect(events[0].priority).toBe("normal");
});

test("Stable and High-Growth Growth Audit results produce no notifications", () => {
  const stable = scoreAudit(answersWithAll(3)); // 3/4 uniform -> 75 -> Stable
  const highGrowth = scoreAudit(answersWithAll(4)); // -> 100 -> High-Growth
  expect(notificationsForGrowthAudit("t1", stable).length).toBe(0);
  expect(notificationsForGrowthAudit("t1", highGrowth).length).toBe(0);
});

test("an NPS detractor response produces an urgent follow-up notification including the comment", () => {
  const events = notificationsForNpsResponse("t1", {
    customerId: "c1",
    score: 3,
    comment: "Delivery was late",
    submittedAt: new Date(),
  });
  expect(events.length).toBe(1);
  expect(events[0].type).toBe("nps_detractor_followup");
  expect(events[0].priority).toBe("urgent");
  expect(events[0].aboutCustomerId).toBe("c1");
  expect(events[0].message).toMatch(/Delivery was late/);
});

test("an NPS detractor response with no comment still produces a notification, without a dangling colon", () => {
  const events = notificationsForNpsResponse("t1", { customerId: "c1", score: 2, submittedAt: new Date() });
  expect(events.length).toBe(1);
  expect(events[0].message).not.toMatch(/: $/);
});

test("passive and promoter NPS responses produce no notifications", () => {
  expect(notificationsForNpsResponse("t1", { customerId: "c1", score: 8, submittedAt: new Date() }).length).toBe(0);
  expect(notificationsForNpsResponse("t1", { customerId: "c1", score: 10, submittedAt: new Date() }).length).toBe(0);
});

test("a rating hidden after moderation produces a normal-priority notification", () => {
  const events = notificationsForModeratedRating("t1", "c1", 1, "hidden");
  expect(events.length).toBe(1);
  expect(events[0].type).toBe("rating_hidden_after_moderation");
  expect(events[0].priority).toBe("normal");
  expect(events[0].aboutCustomerId).toBe("c1");
});

test("a rating moderated to public produces no notification", () => {
  expect(notificationsForModeratedRating("t1", "c1", 5, "public").length).toBe(0);
});

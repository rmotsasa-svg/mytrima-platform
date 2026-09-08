import { scoreAudit, bandFor, validateAnswers, InvalidAuditAnswersError, Answers, GrowthAuditService } from "./growth-audit.service";
import { InMemoryGrowthAuditResponseStore } from "./in-memory-growth-audit-response.store";
import { ALL_QUESTION_IDS } from "./questions.data";

function answersWithAll(value: number): Answers {
  const a: Answers = {};
  for (const id of ALL_QUESTION_IDS) a[id] = value;
  return a;
}

test("all-zero answers score exactly 0 and band as Critical", () => {
  const result = scoreAudit(answersWithAll(0));
  expect(result.overallScore).toBe(0);
  expect(result.band).toBe("Critical");
});

test("all-four (max) answers score exactly 100 and band as High-Growth", () => {
  const result = scoreAudit(answersWithAll(4));
  expect(result.overallScore).toBe(100);
  expect(result.band).toBe("High-Growth");
});

test("section weights sum to 100 across a full scoring run", () => {
  const result = scoreAudit(answersWithAll(2)); // arbitrary uniform input
  const totalWeight = result.sections.reduce((s, sec) => s + sec.weightPct, 0);
  expect(totalWeight).toBe(100);
});

test("uniform half-score (2 of 4) on every question yields overall score 50", () => {
  // Each section's raw/max ratio is 2/4 = 50% regardless of section size,
  // so the weighted sum must be exactly 50 — this is the case most likely
  // to silently break if a section's question count or weight drifts.
  const result = scoreAudit(answersWithAll(2));
  expect(result.overallScore).toBe(50);
  expect(result.band).toBe("Weak");
});

test("hand-calculated partial example matches the engine", () => {
  // Section A (8 q, weight 20%): all answered 4 -> raw 32/32 -> 100% -> contributes 20
  // Section B (8 q, weight 20%): all answered 0 -> raw 0/32 -> 0%   -> contributes 0
  // Sections C-G: all answered 4 -> 100% each -> contributes their full weight (15+15+10+10+10=60)
  // Expected overall = 20 + 0 + 60 = 80 -> High-Growth
  const answers = answersWithAll(4);
  for (let id = 9; id <= 16; id++) answers[id] = 0; // zero out Section B
  const result = scoreAudit(answers);
  expect(result.overallScore).toBe(80);
  expect(result.band).toBe("High-Growth");

  const sectionA = result.sections.find((s) => s.key === "A")!;
  const sectionB = result.sections.find((s) => s.key === "B")!;
  expect(sectionA.weightedContribution).toBe(20);
  expect(sectionB.weightedContribution).toBe(0);
});

test("band boundaries match the Performance Scale Index exactly (0-40 / 41-60 / 61-75 / 76-100)", () => {
  expect(bandFor(0)).toBe("Critical");
  expect(bandFor(40)).toBe("Critical");
  expect(bandFor(40.01)).toBe("Weak");
  expect(bandFor(60)).toBe("Weak");
  expect(bandFor(60.01)).toBe("Stable");
  expect(bandFor(75)).toBe("Stable");
  expect(bandFor(75.01)).toBe("High-Growth");
  expect(bandFor(100)).toBe("High-Growth");
});

test("missing answer throws InvalidAuditAnswersError rather than silently scoring", () => {
  const answers = answersWithAll(3);
  delete answers[17];
  expect(() => validateAnswers(answers)).toThrow(InvalidAuditAnswersError);
});

test("out-of-range score (5) throws rather than silently clamping", () => {
  const answers = answersWithAll(3);
  answers[1] = 5;
  expect(() => validateAnswers(answers)).toThrow(InvalidAuditAnswersError);
});

test("negative score throws", () => {
  const answers = answersWithAll(3);
  answers[1] = -1;
  expect(() => validateAnswers(answers)).toThrow(InvalidAuditAnswersError);
});

test("non-integer score throws", () => {
  const answers = answersWithAll(3);
  answers[1] = 2.5;
  expect(() => validateAnswers(answers)).toThrow(InvalidAuditAnswersError);
});

test("unknown question id in answers throws", () => {
  const answers = answersWithAll(3);
  (answers as Answers)[41] = 2;
  expect(() => validateAnswers(answers)).toThrow(InvalidAuditAnswersError);
});

/**
 * Regression coverage for the real gap this file's scoring functions don't
 * touch at all: nothing previously persisted a submission past the single
 * request that computed it, even though growth_audit_response has existed,
 * with RLS, since this scaffold's first migration.
 */
test("submit persists a response that listForTenant can read back", async () => {
  const service = new GrowthAuditService(new InMemoryGrowthAuditResponseStore());
  const response = await service.submit("t1", answersWithAll(4), "r1");
  expect(response.result.overallScore).toBe(100);

  const list = await service.listForTenant("t1");
  expect(list).toHaveLength(1);
  expect(list[0].id).toBe("r1");
  expect(list[0].result.band).toBe("High-Growth");
});

test("submit rejects invalid answers before ever reaching the store — nothing is persisted", async () => {
  const service = new GrowthAuditService(new InMemoryGrowthAuditResponseStore());
  const badAnswers = answersWithAll(3);
  delete badAnswers[1];
  await expect(service.submit("t1", badAnswers, "r1")).rejects.toThrow(InvalidAuditAnswersError);
  expect(await service.listForTenant("t1")).toEqual([]);
});

test("listForTenant is tenant-scoped: another tenant's submission does not appear", async () => {
  const service = new GrowthAuditService(new InMemoryGrowthAuditResponseStore());
  await service.submit("tenant-A", answersWithAll(2), "r1");
  const listB = await service.listForTenant("tenant-B");
  expect(listB).toEqual([]);
});

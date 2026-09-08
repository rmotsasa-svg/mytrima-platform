import { categorize, computeNps, needsFollowUp, InvalidNpsScoreError, NpsResponse, NpsService } from "./nps.service";
import { InMemoryNpsResponseStore } from "./in-memory-nps-response.store";

test("categorize: 0-6 detractor, 7-8 passive, 9-10 promoter", () => {
  for (let s = 0; s <= 6; s++) expect(categorize(s)).toBe("detractor");
  for (let s = 7; s <= 8; s++) expect(categorize(s)).toBe("passive");
  for (let s = 9; s <= 10; s++) expect(categorize(s)).toBe("promoter");
});

test("categorize rejects out-of-range and non-integer scores", () => {
  expect(() => categorize(11)).toThrow(InvalidNpsScoreError);
  expect(() => categorize(-1)).toThrow(InvalidNpsScoreError);
  expect(() => categorize(7.5)).toThrow(InvalidNpsScoreError);
});

function mkResponses(scores: number[]): NpsResponse[] {
  return scores.map((score, i) => ({ customerId: `c${i}`, score, submittedAt: new Date() }));
}

test("computeNps: all promoters -> +100", () => {
  expect(computeNps(mkResponses([9, 10, 9, 10]))).toBe(100);
});

test("computeNps: all detractors -> -100", () => {
  expect(computeNps(mkResponses([0, 3, 6, 6]))).toBe(-100);
});

test("computeNps: known mixed example matches hand calculation", () => {
  // 10 responses: 5 promoters (9,9,10,10,10), 2 passives (7,8), 3 detractors (2,4,6)
  // %promoters = 50, %detractors = 30 -> NPS = 20
  const scores = [9, 9, 10, 10, 10, 7, 8, 2, 4, 6];
  expect(computeNps(mkResponses(scores))).toBe(20);
});

test("computeNps: empty response set returns 0, not NaN or a throw", () => {
  expect(computeNps([])).toBe(0);
});

test("needsFollowUp is true only for detractors", () => {
  expect(needsFollowUp({ customerId: "a", score: 3, submittedAt: new Date() })).toBe(true);
  expect(needsFollowUp({ customerId: "b", score: 8, submittedAt: new Date() })).toBe(false);
  expect(needsFollowUp({ customerId: "c", score: 10, submittedAt: new Date() })).toBe(false);
});

/**
 * Regression coverage for the real gap this file's pure functions don't
 * touch at all: nothing previously persisted a response past the single
 * request that computed it, so computeNps()'s tenant-wide aggregate had
 * nothing to aggregate over via HTTP even though the math was always real.
 */
test("submit persists a response that aggregateForTenant can compute over", async () => {
  const service = new NpsService(new InMemoryNpsResponseStore());
  await service.submit("t1", "c1", 9, "r1");
  await service.submit("t1", "c2", 2, "r2");
  const agg = await service.aggregateForTenant("t1");
  expect(agg.count).toBe(2);
  expect(agg.nps).toBe(0); // 1 promoter (50%), 1 detractor (50%) -> 50 - 50 = 0
});

test("submit rejects an out-of-range score before ever reaching the store — nothing is persisted", async () => {
  const service = new NpsService(new InMemoryNpsResponseStore());
  await expect(service.submit("t1", "c1", 11, "r1")).rejects.toThrow(InvalidNpsScoreError);
  const agg = await service.aggregateForTenant("t1");
  expect(agg.count).toBe(0);
});

test("aggregateForTenant is tenant-scoped: another tenant's response does not count", async () => {
  const service = new NpsService(new InMemoryNpsResponseStore());
  await service.submit("tenant-A", "c1", 10, "r1");
  const aggB = await service.aggregateForTenant("tenant-B");
  expect(aggB.count).toBe(0);
  expect(aggB.nps).toBe(0);
});

test("aggregateForTenant returns 0/0 for a tenant with no responses, not NaN or a throw", async () => {
  const service = new NpsService(new InMemoryNpsResponseStore());
  const agg = await service.aggregateForTenant("t1");
  expect(agg).toEqual({ nps: 0, count: 0 });
});

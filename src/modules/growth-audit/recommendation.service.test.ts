import { randomUUID } from "node:crypto";
import { rankSectionsByWeightedOpportunity, computeRecommendations, RecommendationSignals } from "./recommendation.service";
import { scoreAudit, AuditResult, Answers, GrowthAuditResponse } from "./growth-audit.service";
import { ALL_QUESTION_IDS } from "./questions.data";

function answersWithAll(value: number): Answers {
  const a: Answers = {};
  for (const id of ALL_QUESTION_IDS) a[id] = value;
  return a;
}

function makeResponse(answers: Answers): GrowthAuditResponse {
  return { id: randomUUID(), tenantId: "t1", answers, result: scoreAudit(answers), submittedAt: new Date() };
}

const allSignalsFalse: RecommendationSignals = {
  hasConversionRateBenchmark: false,
  hasChurnRateBenchmark: false,
  hasAnyKpiBenchmark: false,
  hasRecentRating: false,
  hasActiveDeal: false,
  hasPostedRecently: false,
  hasNotificationPhone: false,
};

describe("rankSectionsByWeightedOpportunity", () => {
  test("uniform sections rank purely by weight, highest first", () => {
    const result = scoreAudit(answersWithAll(2)); // every section at 50%
    const ranked = rankSectionsByWeightedOpportunity(result);
    expect(ranked).toHaveLength(7);
    for (let i = 1; i < ranked.length; i++) {
      expect(ranked[i].weightedOpportunity).toBeLessThanOrEqual(ranked[i - 1].weightedOpportunity);
    }
    // Hand-calculated: (100-50) x weightPct / 100 for weights 20/20/15/15/10/10/10.
    expect(ranked[0].weightedOpportunity).toBe(10); // 0.5 x 20
    expect(ranked[ranked.length - 1].weightedOpportunity).toBe(5); // 0.5 x 10
  });

  test("a heavily-weighted section with a BETTER raw score can still outrank a lightly-weighted section with a WORSE raw score — the whole point of ranking by opportunity, not raw grade", () => {
    const fakeResult: AuditResult = {
      overallScore: 50,
      band: "Weak",
      sections: [
        { key: "A", name: "Sales & Conversion", rawScore: 16, maxScore: 32, sectionPct: 50, weightPct: 20, weightedContribution: 10 }, // opportunity = 50*20/100=10
        { key: "G", name: "Data & Performance Management", rawScore: 6.4, maxScore: 16, sectionPct: 40, weightPct: 10, weightedContribution: 4 }, // worse raw score (40 < 50), opportunity = 60*10/100=6
      ],
    };
    const ranked = rankSectionsByWeightedOpportunity(fakeResult);
    expect(ranked[0].sectionKey).toBe("A"); // the better-scoring section wins because it's worth more
    expect(ranked[0].weightedOpportunity).toBe(10);
    expect(ranked[1].sectionKey).toBe("G");
    expect(ranked[1].weightedOpportunity).toBe(6);
  });
});

describe("computeRecommendations", () => {
  test("recommends a real in-app action for a weak, unmapped-signal question", () => {
    const answers = answersWithAll(4);
    answers[3] = 0; // "state your conversion rate, tracked routinely" — Section A
    const response = makeResponse(answers);

    const result = computeRecommendations(response, allSignalsFalse);
    const action = result.actions.find((a) => a.questionId === 3);
    expect(action).toBeDefined();
    expect(action?.actionKey).toBe("set_conversion_rate_benchmark");
  });

  test("does NOT recommend an action the tenant is already doing, per a real signal — and flags the self-report/real-data divergence instead", () => {
    const answers = answersWithAll(4);
    answers[3] = 0; // answered as weak
    const response = makeResponse(answers);

    const result = computeRecommendations(response, { ...allSignalsFalse, hasConversionRateBenchmark: true }); // but real data says it's done
    expect(result.actions.find((a) => a.questionId === 3)).toBeUndefined();
    const divergence = result.divergences.find((d) => d.questionId === 3);
    expect(divergence).toBeDefined();
  });

  test("does not recommend a question whose score is at or above the weak threshold", () => {
    const answers = answersWithAll(4);
    answers[3] = 2; // not weak enough (threshold is < 2)
    const response = makeResponse(answers);

    const result = computeRecommendations(response, allSignalsFalse);
    expect(result.actions.find((a) => a.questionId === 3)).toBeUndefined();
  });

  test("respects the maxActions cap", () => {
    // Make every mapped question weak — far more than the default cap.
    const answers = answersWithAll(4);
    for (const q of [3, 6, 9, 15, 23, 24, 27, 34, 36, 39]) answers[q] = 0;
    const response = makeResponse(answers);

    const result = computeRecommendations(response, allSignalsFalse, 2);
    expect(result.actions.length).toBeLessThanOrEqual(2);
  });

  test("actions are ordered by the section's weighted opportunity, highest first", () => {
    const answers = answersWithAll(4);
    answers[39] = 0; // Section G, weight 10 — weak
    answers[3] = 0; // Section A, weight 20 — weak
    const response = makeResponse(answers);

    const result = computeRecommendations(response, allSignalsFalse);
    const sectionAIndex = result.actions.findIndex((a) => a.sectionKey === "A");
    const sectionGIndex = result.actions.findIndex((a) => a.sectionKey === "G");
    expect(sectionAIndex).toBeGreaterThanOrEqual(0);
    expect(sectionGIndex).toBeGreaterThanOrEqual(0);
    expect(sectionAIndex).toBeLessThan(sectionGIndex); // A (20% weight) outranks G (10% weight)
  });

  test("flags topSectionHasNoAppSignal when the single weakest section (Business Strategy) has no in-app proxy at all", () => {
    const answers = answersWithAll(4);
    for (let q = 17; q <= 22; q++) answers[q] = 0; // Section C entirely weak, everything else perfect
    const response = makeResponse(answers);

    const result = computeRecommendations(response, allSignalsFalse);
    expect(result.actions).toHaveLength(0);
    expect(result.rankedSections[0].sectionKey).toBe("C");
    expect(result.topSectionHasNoAppSignal).toBe(true);
  });

  test("the same actionKey is never recommended twice even when two weak questions map to it", () => {
    const answers = answersWithAll(4);
    answers[9] = 0; // "measure satisfaction" -> request_rating
    answers[15] = 0; // "collect feedback regularly" -> request_rating (same action)
    const response = makeResponse(answers);

    const result = computeRecommendations(response, allSignalsFalse);
    const requestRatingActions = result.actions.filter((a) => a.actionKey === "request_rating");
    expect(requestRatingActions).toHaveLength(1);
  });
});

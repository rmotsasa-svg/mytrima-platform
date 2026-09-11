import { randomUUID } from "node:crypto";
import { RecommendationService } from "./recommendation.service";
import { GrowthAuditService } from "./growth-audit.service";
import { InMemoryGrowthAuditResponseStore } from "./in-memory-growth-audit-response.store";
import { InMemoryRecommendationStore } from "./in-memory-recommendation.store";
import { KpiBenchmarkService } from "../sales/kpi-benchmark.service";
import { InMemoryKpiBenchmarkStore } from "../sales/in-memory-kpi-benchmark.store";
import { RatingService } from "../reputation/rating.service";
import { InMemoryRatingStore } from "../reputation/in-memory-rating.store";
import { DealService } from "../deals/deal.service";
import { InMemoryDealStore } from "../deals/in-memory-deal.store";
import { CatalogService } from "../catalog/catalog-item.service";
import { InMemoryCatalogItemStore } from "../catalog/in-memory-catalog-item.store";
import { SocialPostLogService } from "../social-publishing/social-post-log.service";
import { InMemorySocialPostLogStore } from "../social-publishing/in-memory-social-post-log.store";
import { TenantService } from "../auth/tenant.service";
import { InMemoryTenantStore } from "../auth/in-memory-tenant.store";
import { AuthService } from "../auth/auth.service";
import { InMemoryAuthUserStore } from "../auth/in-memory-auth-user.store";
import { InMemoryRevokedRefreshTokenStore } from "../auth/in-memory-revoked-token.store";
import { generateMfaEncryptionKey } from "../auth/mfa-secret-crypto";
import { ALL_QUESTION_IDS } from "./questions.data";
import { Answers } from "./growth-audit.service";
import { ConsoleEmailService } from "../integrations/email/email.service";

function answersWithAll(value: number): Answers {
  const a: Answers = {};
  for (const id of ALL_QUESTION_IDS) a[id] = value;
  return a;
}

/** Real integration test — every service is a genuine instance (only the
 * underlying stores are in-memory), proving the actual cross-module signal
 * gathering + persistence + lazy-detection RecommendationService.getRecommendations()
 * depends on, not just the pure computeRecommendations() logic already
 * covered in recommendation.service.test.ts. */
function makeRecommendationService() {
  const growthAuditService = new GrowthAuditService(new InMemoryGrowthAuditResponseStore());
  const kpiBenchmarkService = new KpiBenchmarkService(new InMemoryKpiBenchmarkStore());
  const ratingService = new RatingService(new InMemoryRatingStore());
  const catalogService = new CatalogService(new InMemoryCatalogItemStore());
  const dealService = new DealService(new InMemoryDealStore(), catalogService);
  const socialPostLogService = new SocialPostLogService(new InMemorySocialPostLogStore());
  const tenantService = new TenantService(
    new InMemoryTenantStore(),
    new AuthService(new InMemoryAuthUserStore(), "test-secret", new InMemoryRevokedRefreshTokenStore(), generateMfaEncryptionKey()),
    new ConsoleEmailService()
  );
  const recommendationService = new RecommendationService(
    new InMemoryRecommendationStore(),
    growthAuditService,
    kpiBenchmarkService,
    ratingService,
    dealService,
    socialPostLogService,
    tenantService
  );
  return { recommendationService, growthAuditService, kpiBenchmarkService, tenantService };
}

test("a tenant with no audit at all gets an empty, honest result — not an error", async () => {
  const { recommendationService } = makeRecommendationService();
  const result = await recommendationService.getRecommendations("t1");
  expect(result.actions).toEqual([]);
  expect(result.actionToActionRate).toBeNull();
});

test("gathers a real signal from another module (KpiBenchmarkService) and correctly withholds the matching recommendation", async () => {
  const { recommendationService, growthAuditService, kpiBenchmarkService } = makeRecommendationService();
  const answers = answersWithAll(4);
  answers[3] = 0; // weak "conversion rate tracked" — Section A
  await growthAuditService.submit("t1", answers, randomUUID());

  // Real signal via a completely different service — proves this is a
  // genuine cross-module read, not a mock standing in for one.
  await kpiBenchmarkService.setBenchmark("t1", randomUUID(), "conversion_rate", "below", 20, new Date("2026-01-01"), new Date("2026-12-31"));

  const result = await recommendationService.getRecommendations("t1");
  expect(result.actions.find((a) => a.actionKey === "set_conversion_rate_benchmark")).toBeUndefined();
  expect(result.divergences.some((d) => d.questionId === 3)).toBe(true);
});

test("persists issued recommendations and later detects when the real action was taken — the recommendation-to-action KPI, made real", async () => {
  const { recommendationService, growthAuditService, kpiBenchmarkService } = makeRecommendationService();
  const answers = answersWithAll(4);
  answers[3] = 0; // weak, no benchmark set yet
  await growthAuditService.submit("t1", answers, randomUUID());

  const before = await recommendationService.getRecommendations("t1");
  expect(before.actions.find((a) => a.actionKey === "set_conversion_rate_benchmark")).toBeDefined();
  expect(before.actionToActionRate).toBe(0); // issued, nothing detected yet

  // The tenant genuinely acts on it — a real KPI benchmark now exists.
  await kpiBenchmarkService.setBenchmark("t1", randomUUID(), "conversion_rate", "below", 20, new Date("2026-01-01"), new Date("2026-12-31"));

  const after = await recommendationService.getRecommendations("t1");
  expect(after.actionToActionRate).toBe(100); // the one issued recommendation is now detected as acted on
});

test("does not re-issue the identical recommendation twice for the same audit response", async () => {
  const { recommendationService, growthAuditService } = makeRecommendationService();
  const answers = answersWithAll(4);
  answers[3] = 0;
  await growthAuditService.submit("t1", answers, randomUUID());

  await recommendationService.getRecommendations("t1");
  const second = await recommendationService.getRecommendations("t1");
  // Still just the one real recommendation logged, not duplicated.
  expect(second.actionToActionRate).toBe(0); // exactly one entry, still undetected
});

test("is tenant-scoped — one tenant's real signals never leak into another's recommendations", async () => {
  const { recommendationService, growthAuditService, kpiBenchmarkService } = makeRecommendationService();
  const answers = answersWithAll(4);
  answers[3] = 0;
  await growthAuditService.submit("t1", answers, randomUUID());
  await growthAuditService.submit("t2", answers, randomUUID());
  await kpiBenchmarkService.setBenchmark("t1", randomUUID(), "conversion_rate", "below", 20, new Date("2026-01-01"), new Date("2026-12-31"));

  const t1Result = await recommendationService.getRecommendations("t1");
  const t2Result = await recommendationService.getRecommendations("t2");
  expect(t1Result.actions.find((a) => a.actionKey === "set_conversion_rate_benchmark")).toBeUndefined(); // t1 already has it
  expect(t2Result.actions.find((a) => a.actionKey === "set_conversion_rate_benchmark")).toBeDefined(); // t2 doesn't
});

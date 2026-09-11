import { randomUUID } from "node:crypto";
import { SnapshotService } from "./snapshot.service";
import { SaleService } from "../sales/sale.service";
import { InMemorySaleStore } from "../sales/in-memory-sale.store";
import { NpsService } from "../growth-audit/nps.service";
import { InMemoryNpsResponseStore } from "../growth-audit/in-memory-nps-response.store";
import { RatingService } from "../reputation/rating.service";
import { InMemoryRatingStore } from "../reputation/in-memory-rating.store";
import { GrowthAuditService } from "../growth-audit/growth-audit.service";
import { InMemoryGrowthAuditResponseStore } from "../growth-audit/in-memory-growth-audit-response.store";
import { RecommendationService } from "../growth-audit/recommendation.service";
import { InMemoryRecommendationStore } from "../growth-audit/in-memory-recommendation.store";
import { KpiBenchmarkService } from "../sales/kpi-benchmark.service";
import { InMemoryKpiBenchmarkStore } from "../sales/in-memory-kpi-benchmark.store";
import { DealService } from "../deals/deal.service";
import { InMemoryDealStore } from "../deals/in-memory-deal.store";
import { CatalogService } from "../catalog/catalog-item.service";
import { InMemoryCatalogItemStore } from "../catalog/in-memory-catalog-item.store";
import { SocialPostLogService } from "../social-publishing/social-post-log.service";
import { InMemorySocialPostLogStore } from "../social-publishing/in-memory-social-post-log.store";
import { SocialConnectionService } from "../social-publishing/social-connection.service";
import { InMemorySocialConnectionStore } from "../social-publishing/in-memory-social-connection.store";
import { SocialMetricsService } from "../social-publishing/social-metrics.service";
import { TenantService } from "../auth/tenant.service";
import { InMemoryTenantStore } from "../auth/in-memory-tenant.store";
import { AuthService } from "../auth/auth.service";
import { InMemoryAuthUserStore } from "../auth/in-memory-auth-user.store";
import { InMemoryRevokedRefreshTokenStore } from "../auth/in-memory-revoked-token.store";
import { generateMfaEncryptionKey } from "../auth/mfa-secret-crypto";
import { ConsoleEmailService } from "../integrations/email/email.service";

/** Real integration test — every service is a genuine instance (only the
 * underlying stores are in-memory), proving the actual cross-module
 * aggregation SnapshotService.getSnapshot() depends on, not just the pure
 * buildFindingsAndMethodology() logic already covered in
 * snapshot.service.test.ts. */
function makeSnapshotService() {
  const catalogService = new CatalogService(new InMemoryCatalogItemStore());
  const dealService = new DealService(new InMemoryDealStore(), catalogService);
  const ratingService = new RatingService(new InMemoryRatingStore());
  const npsService = new NpsService(new InMemoryNpsResponseStore());
  const saleService = new SaleService(new InMemorySaleStore(), dealService, ratingService, npsService);
  const growthAuditService = new GrowthAuditService(new InMemoryGrowthAuditResponseStore());
  const kpiBenchmarkService = new KpiBenchmarkService(new InMemoryKpiBenchmarkStore());
  const socialPostLogService = new SocialPostLogService(new InMemorySocialPostLogStore());
  const socialConnectionService = new SocialConnectionService(new InMemorySocialConnectionStore());
  const socialMetricsService = new SocialMetricsService(socialConnectionService, socialPostLogService);
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
  const snapshotService = new SnapshotService(
    saleService,
    npsService,
    ratingService,
    growthAuditService,
    recommendationService,
    socialMetricsService
  );
  return { snapshotService, saleService, npsService, ratingService, growthAuditService, socialConnectionService, socialPostLogService };
}

test("a tenant with no activity at all gets an honest, empty-but-valid snapshot", async () => {
  const { snapshotService } = makeSnapshotService();
  const period = { start: new Date("2026-02-01"), end: new Date("2026-02-28") };
  const snapshot = await snapshotService.getSnapshot("t1", period);

  expect(snapshot.performance.salesAmount.current).toBe(0);
  expect(snapshot.performance.repeatRate.current).toBeNull();
  expect(snapshot.growthAudit.latestScore).toBeNull();
  expect(snapshot.methodology.length).toBeGreaterThan(0);
  // No Facebook Page connected -> an honest "not connected" state, not a
  // fabricated zero for every Meta metric.
  expect(snapshot.socialMetrics.connected).toBe(false);
  expect(snapshot.socialMetrics.facebook).toBeNull();
});

test("socialMetrics aggregates real Meta numbers for a connected tenant — engagement summed per logged post, insights summed per day, a missing scope disclosed by name", async () => {
  const { snapshotService, socialConnectionService, socialPostLogService } = makeSnapshotService();
  await socialConnectionService.save({
    id: "conn1",
    tenantId: "t1",
    provider: "facebook",
    pageId: "123456789",
    pageName: "Thabo Hair & Beauty",
    pageAccessToken: "test-page-token",
    instagramAccountId: null,
    connectedAt: new Date("2026-08-01"),
  });
  await socialPostLogService.record({ id: "log1", tenantId: "t1", provider: "facebook", postId: "123456789_1", postedAt: new Date("2026-02-05") });
  await socialPostLogService.record({ id: "log2", tenantId: "t1", provider: "facebook", postId: "123456789_2", postedAt: new Date("2026-02-15") });

  const fetchMock = jest.fn();
  const jsonBodies: Record<string, unknown> = {
    "123456789?fields=followers_count": { followers_count: 842 },
    "123456789_1": { reactions: { summary: { total_count: 10 } }, comments: { summary: { total_count: 2 } } },
    "123456789_2": { reactions: { summary: { total_count: 5 } }, comments: { summary: { total_count: 1 } }, shares: { count: 3 } },
    "insights": {
      data: [
        { name: "page_impressions", values: [{ value: 100 }, { value: 150 }] },
        { name: "page_views_total", values: [{ value: 10 }] },
      ],
    },
    "conversations": { error: { message: "(#200) Requires pages_messaging permission", type: "OAuthException", code: 200 } },
  };
  fetchMock.mockImplementation(async (url: string) => {
    const key = Object.keys(jsonBodies).find((k) => url.includes(k));
    return { json: async () => (key ? jsonBodies[key] : { error: { message: "unexpected url in test: " + url } }) };
  });
  (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch;

  const period = { start: new Date("2026-02-01"), end: new Date("2026-02-28") };
  const snapshot = await snapshotService.getSnapshot("t1", period);

  expect(snapshot.socialMetrics.connected).toBe(true);
  expect(snapshot.socialMetrics.pageName).toBe("Thabo Hair & Beauty");
  expect(snapshot.socialMetrics.facebook).toEqual({
    followers: 842,
    impressions: 250,
    views: 10,
    messageThreads: null, // permission not granted -> null, not 0
    likes: 15, // 10 + 5, summed across both real logged posts
    comments: 3,
    shares: 3,
    postsInPeriod: 2,
  });
  expect(snapshot.socialMetrics.unavailable["facebook.messageThreads"]).toContain("pages_messaging");
  expect(snapshot.socialMetrics.instagram).toEqual({ connected: false, followers: null, views: null, likes: 0, comments: 0, shares: 0, postsInPeriod: 0 });
});

test("gathers real sales data across two real periods and computes a real delta", async () => {
  const { snapshotService, saleService } = makeSnapshotService();
  const period = { start: new Date("2026-02-01"), end: new Date("2026-02-28") };

  // Jan 15 falls within the real computed previous period regardless of its
  // exact boundary (previousPeriod() gives a same-length window ending
  // immediately before period.start, not a naive calendar-month guess).
  await saleService.recordSale("t1", "s1", { occurredAt: new Date("2026-01-15"), lineItems: [{ description: "X", quantity: 1, unitPrice: 100 }] });
  await saleService.recordSale("t1", "s2", { occurredAt: new Date("2026-02-10"), lineItems: [{ description: "X", quantity: 1, unitPrice: 200 }] });

  const snapshot = await snapshotService.getSnapshot("t1", period);
  expect(snapshot.performance.salesAmount.current).toBe(200);
  expect(snapshot.performance.salesAmount.previous).toBe(100);
  expect(snapshot.performance.salesAmount.percentChange).toBe(100); // doubled
  expect(snapshot.performance.totalUnits.current).toBe(1);
  expect(snapshot.performance.totalUnits.previous).toBe(1);
  // The real invariant previousPeriod() guarantees: same length as `period`, ending exactly 1ms before it starts — not a specific calendar-month guess.
  expect(snapshot.previousPeriod.end.getTime()).toBe(period.start.getTime() - 1);
  expect(snapshot.previousPeriod.end.getTime() - snapshot.previousPeriod.start.getTime()).toBe(period.end.getTime() - period.start.getTime());
});

test("includes the real Growth Audit score and a real recommendation-engine action item", async () => {
  const { snapshotService, growthAuditService } = makeSnapshotService();
  const answers: Record<number, number> = {};
  for (let i = 1; i <= 40; i++) answers[i] = 4;
  answers[3] = 0; // weak conversion-rate tracking -> a real recommendation
  await growthAuditService.submit("t1", answers, randomUUID());

  const period = { start: new Date("2026-02-01"), end: new Date("2026-02-28") };
  const snapshot = await snapshotService.getSnapshot("t1", period);

  expect(snapshot.growthAudit.latestBand).toBe("High-Growth");
  expect(snapshot.actionPlan.some((a) => a.label.includes("conversion rate"))).toBe(true);
  expect(snapshot.actionPlan.every((a) => a.category === "quick_win" || a.category === "strategic")).toBe(true);
});

test("is tenant-scoped — one tenant's real sales never leak into another's snapshot", async () => {
  const { snapshotService, saleService } = makeSnapshotService();
  await saleService.recordSale("t1", "s1", { occurredAt: new Date("2026-02-10"), lineItems: [{ description: "X", quantity: 1, unitPrice: 100 }] });
  await saleService.recordSale("t2", "s2", { occurredAt: new Date("2026-02-10"), lineItems: [{ description: "Y", quantity: 1, unitPrice: 9999 }] });

  const period = { start: new Date("2026-02-01"), end: new Date("2026-02-28") };
  const snapshot = await snapshotService.getSnapshot("t1", period);
  expect(snapshot.performance.salesAmount.current).toBe(100);
});

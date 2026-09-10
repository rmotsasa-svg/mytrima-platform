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
import { TenantService } from "../auth/tenant.service";
import { InMemoryTenantStore } from "../auth/in-memory-tenant.store";
import { AuthService } from "../auth/auth.service";
import { InMemoryAuthUserStore } from "../auth/in-memory-auth-user.store";
import { InMemoryRevokedRefreshTokenStore } from "../auth/in-memory-revoked-token.store";
import { generateMfaEncryptionKey } from "../auth/mfa-secret-crypto";

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
  const tenantService = new TenantService(
    new InMemoryTenantStore(),
    new AuthService(new InMemoryAuthUserStore(), "test-secret", new InMemoryRevokedRefreshTokenStore(), generateMfaEncryptionKey())
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
  const snapshotService = new SnapshotService(saleService, npsService, ratingService, growthAuditService, recommendationService);
  return { snapshotService, saleService, npsService, ratingService, growthAuditService };
}

test("a tenant with no activity at all gets an honest, empty-but-valid snapshot", async () => {
  const { snapshotService } = makeSnapshotService();
  const period = { start: new Date("2026-02-01"), end: new Date("2026-02-28") };
  const snapshot = await snapshotService.getSnapshot("t1", period);

  expect(snapshot.performance.salesAmount.current).toBe(0);
  expect(snapshot.performance.repeatRate.current).toBeNull();
  expect(snapshot.growthAudit.latestScore).toBeNull();
  expect(snapshot.methodology.length).toBeGreaterThan(0);
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

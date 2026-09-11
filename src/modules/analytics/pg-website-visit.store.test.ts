import { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { AnalyticsService } from "./website-visit.service";
import { PgWebsiteVisitStore } from "./pg-website-visit.store";
import { runWithTenantContext } from "../../common/postgres";

/**
 * REAL integration test against a live PostgreSQL instance — gated behind
 * TEST_DATABASE_URL, same as every other pg store test here. Exercises the
 * real `website_visit` table (0025_website_analytics.sql) including its
 * RLS policy — a second tenant's rows must never appear in the first
 * tenant's own summary, the exact property PgBookingStore's own
 * "listForTenant is tenant-scoped, enforced by RLS" test already proved
 * for that table.
 */
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const maybeDescribe = TEST_DATABASE_URL ? describe : describe.skip;

maybeDescribe("PgWebsiteVisitStore + AnalyticsService against a real PostgreSQL instance", () => {
  const pool = new Pool({ connectionString: TEST_DATABASE_URL });
  const analyticsService = new AnalyticsService(new PgWebsiteVisitStore(pool));
  const tenantId = randomUUID();

  beforeAll(async () => {
    await pool.query("insert into tenant (id, name) values ($1, 'PgWebsiteVisitStore test tenant')", [tenantId]);
  });

  afterAll(async () => {
    await runWithTenantContext(pool, tenantId, (client) => client.query("delete from tenant where id = $1", [tenantId]));
    await pool.end();
  });

  test("recordVisit persists a real row, and getSummary aggregates it back with device_type derived server-side", async () => {
    await analyticsService.recordVisit({
      id: randomUUID(),
      tenantId,
      sessionId: "session-a",
      path: "/pricing",
      referrer: "https://google.com",
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15",
    });

    const start = new Date(Date.now() - 60 * 60 * 1000);
    const end = new Date(Date.now() + 60 * 60 * 1000);
    const summary = await analyticsService.getSummary(tenantId, start, end);

    expect(summary.totalVisits).toBe(1);
    expect(summary.uniqueSessions).toBe(1);
    expect(summary.topPaths[0]).toEqual({ path: "/pricing", count: 1 });
    expect(summary.deviceBreakdown.mobile).toBe(1);
  });

  test("getSummary is tenant-scoped, enforced by RLS", async () => {
    const otherTenantId = randomUUID();
    await pool.query("insert into tenant (id, name) values ($1, 'other tenant')", [otherTenantId]);
    const otherService = new AnalyticsService(new PgWebsiteVisitStore(pool));
    await otherService.recordVisit({ id: randomUUID(), tenantId: otherTenantId, sessionId: "session-b", path: "/" });

    const start = new Date(Date.now() - 60 * 60 * 1000);
    const end = new Date(Date.now() + 60 * 60 * 1000);
    const summary = await analyticsService.getSummary(tenantId, start, end);
    expect(summary.topPaths.some((p) => p.path === "/")).toBe(false);

    await runWithTenantContext(pool, otherTenantId, (client) => client.query("delete from tenant where id = $1", [otherTenantId]));
  });
});

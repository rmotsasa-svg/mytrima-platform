import { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { PgRecommendationStore } from "./pg-recommendation.store";
import { PgGrowthAuditResponseStore } from "./pg-growth-audit-response.store";
import { GrowthAuditService } from "./growth-audit.service";
import { runWithTenantContext } from "../../common/postgres";
import { ALL_QUESTION_IDS } from "./questions.data";
import { Answers } from "./growth-audit.service";

function answersWithAll(value: number): Answers {
  const a: Answers = {};
  for (const id of ALL_QUESTION_IDS) a[id] = value;
  return a;
}

/**
 * REAL integration test against a live PostgreSQL instance — gated behind
 * TEST_DATABASE_URL, same pattern as every other Pg*Store test in this
 * project. Proves real RLS tenant scoping AND the tenant-context fix on
 * markDetected() (see recommendation.service.ts's own "RecommendationStore"
 * comment — a bug caught before it shipped: an update with no tenant
 * context set would silently affect zero rows under this table's own RLS
 * policy).
 */
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const maybeDescribe = TEST_DATABASE_URL ? describe : describe.skip;

maybeDescribe("PgRecommendationStore against a real PostgreSQL instance", () => {
  const pool = new Pool({ connectionString: TEST_DATABASE_URL });
  const store = new PgRecommendationStore(pool);
  const growthAuditService = new GrowthAuditService(new PgGrowthAuditResponseStore(pool));
  const tenantId = randomUUID();
  let growthAuditResponseId: string;

  beforeAll(async () => {
    await pool.query("insert into tenant (id, name) values ($1, 'PgRecommendationStore test tenant')", [tenantId]);
    const response = await growthAuditService.submit(tenantId, answersWithAll(2), randomUUID());
    growthAuditResponseId = response.id;
  });

  afterAll(async () => {
    await runWithTenantContext(pool, tenantId, (client) => client.query("delete from tenant where id = $1", [tenantId]));
    await pool.end();
  });

  test("save persists a real row, retrievable by findAllForTenant", async () => {
    await store.save({
      id: randomUUID(),
      tenantId,
      growthAuditResponseId,
      sectionKey: "A",
      questionId: 3,
      actionKey: "set_conversion_rate_benchmark",
      actionLabel: "Set a KPI benchmark for your conversion rate",
      createdAt: new Date(),
      actionDetectedAt: null,
    });

    const entries = await store.findAllForTenant(tenantId);
    expect(entries).toHaveLength(1);
    expect(entries[0].actionDetectedAt).toBeNull();
  });

  test("markDetected genuinely updates the real row — the real bug this project caught: without the correct tenant context, RLS would silently affect zero rows", async () => {
    const [entry] = await store.findAllForTenant(tenantId);
    const detectedAt = new Date();
    await store.markDetected(tenantId, entry.id, detectedAt);

    const [updated] = await store.findAllForTenant(tenantId);
    expect(updated.actionDetectedAt).not.toBeNull();
  });

  test("findAllForTenant is tenant-scoped, enforced by RLS", async () => {
    const otherTenantId = randomUUID();
    await pool.query("insert into tenant (id, name) values ($1, 'other tenant')", [otherTenantId]);
    const otherResponse = await growthAuditService.submit(otherTenantId, answersWithAll(2), randomUUID());
    await store.save({
      id: randomUUID(),
      tenantId: otherTenantId,
      growthAuditResponseId: otherResponse.id,
      sectionKey: "B",
      questionId: 9,
      actionKey: "request_rating",
      actionLabel: "Request a rating",
      createdAt: new Date(),
      actionDetectedAt: null,
    });

    const entries = await store.findAllForTenant(tenantId);
    expect(entries.every((e) => e.actionKey !== "request_rating")).toBe(true);

    await runWithTenantContext(pool, otherTenantId, (client) => client.query("delete from tenant where id = $1", [otherTenantId]));
  });
});

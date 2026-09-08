import { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { GrowthAuditService } from "./growth-audit.service";
import { PgGrowthAuditResponseStore } from "./pg-growth-audit-response.store";
import { ALL_QUESTION_IDS } from "./questions.data";
import { Answers } from "./growth-audit.service";

/**
 * REAL integration test against a live PostgreSQL instance — gated behind
 * TEST_DATABASE_URL. See src/common/postgres.test.ts for the connection
 * requirements.
 */
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const maybeDescribe = TEST_DATABASE_URL ? describe : describe.skip;

function answersWithAll(value: number): Answers {
  const a: Answers = {};
  for (const id of ALL_QUESTION_IDS) a[id] = value;
  return a;
}

maybeDescribe("PgGrowthAuditResponseStore + GrowthAuditService against a real PostgreSQL instance", () => {
  const pool = new Pool({ connectionString: TEST_DATABASE_URL });
  const service = new GrowthAuditService(new PgGrowthAuditResponseStore(pool));
  const tenantId = randomUUID();

  beforeAll(async () => {
    await pool.query("insert into tenant (id, name) values ($1, 'PgGrowthAuditResponseStore test tenant')", [tenantId]);
  });

  afterAll(async () => {
    await pool.query("delete from tenant where id = $1", [tenantId]); // cascades to growth_audit_response
    await pool.end();
  });

  test("submit persists a real row, including the full jsonb answers and section scores", async () => {
    const response = await service.submit(tenantId, answersWithAll(4), randomUUID());
    expect(response.result.overallScore).toBe(100);

    const list = await service.listForTenant(tenantId);
    const found = list.find((r) => r.id === response.id)!;
    expect(found.result.band).toBe("High-Growth");
    // Round-tripped through real jsonb columns, not just held in memory —
    // confirms node-postgres's automatic JS<->jsonb (de)serialization
    // actually works here, not just in theory.
    expect(found.answers[1]).toBe(4);
    expect(found.result.sections).toHaveLength(7);
    expect(found.result.sections[0].key).toBe("A");
  });

  test("listForTenant is tenant-scoped, enforced by RLS", async () => {
    const otherTenantId = randomUUID();
    await pool.query("insert into tenant (id, name) values ($1, 'other tenant')", [otherTenantId]);
    await service.submit(otherTenantId, answersWithAll(0), randomUUID());

    const list = await service.listForTenant(tenantId);
    expect(list.every((r) => r.tenantId === tenantId)).toBe(true);

    await pool.query("delete from tenant where id = $1", [otherTenantId]);
  });

  test("an invalid submission is rejected before touching the database at all", async () => {
    const badAnswers = answersWithAll(2);
    delete (badAnswers as Record<number, number>)[5];
    const before = await service.listForTenant(tenantId);
    await expect(service.submit(tenantId, badAnswers, randomUUID())).rejects.toThrow();
    const after = await service.listForTenant(tenantId);
    expect(after).toHaveLength(before.length); // nothing new was inserted
  });
});

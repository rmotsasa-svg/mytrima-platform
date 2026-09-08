import { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { RatingService } from "./rating.service";
import { PgRatingStore } from "./pg-rating.store";
import { runWithTenantContext } from "../../common/postgres";

/**
 * REAL integration test against a live PostgreSQL instance — gated behind
 * TEST_DATABASE_URL. See src/common/postgres.test.ts for the connection
 * requirements.
 */
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const maybeDescribe = TEST_DATABASE_URL ? describe : describe.skip;

maybeDescribe("PgRatingStore + RatingService against a real PostgreSQL instance", () => {
  const pool = new Pool({ connectionString: TEST_DATABASE_URL });
  const service = new RatingService(new PgRatingStore(pool));
  const tenantId = randomUUID();
  const customerId = randomUUID();

  beforeAll(async () => {
    await pool.query("insert into tenant (id, name) values ($1, 'PgRatingStore test tenant')", [tenantId]);
    await runWithTenantContext(pool, tenantId, (client) =>
      client.query("insert into customer (id, tenant_id, display_name) values ($1, $2, 'Test customer')", [customerId, tenantId])
    );
  });

  afterAll(async () => {
    await pool.query("delete from tenant where id = $1", [tenantId]); // cascades to customer + rating
    await pool.end();
  });

  test("submit persists a 'pending' rating to the real database", async () => {
    const rating = await service.submit(tenantId, customerId, 5, randomUUID(), "Great!");
    expect(rating.status).toBe("pending");

    const agg = await service.aggregateForTenant(tenantId);
    expect(agg.count).toBe(0); // still pending, correctly excluded
  });

  test("moderate to 'public' actually updates the real row, reflected in the aggregate", async () => {
    const rating = await service.submit(tenantId, customerId, 4, randomUUID());
    await service.moderate(tenantId, rating.id, "public");

    const agg = await service.aggregateForTenant(tenantId);
    expect(agg.count).toBeGreaterThanOrEqual(1);
  });

  test("moderate with the wrong tenantId does not touch a real row — enforced by RLS, not app logic", async () => {
    const otherTenantId = randomUUID();
    await pool.query("insert into tenant (id, name) values ($1, 'other tenant')", [otherTenantId]);

    const rating = await service.submit(tenantId, customerId, 3, randomUUID());
    const result = await service.moderate(otherTenantId, rating.id, "public"); // wrong tenant — should have no effect
    expect(result).toBeNull();

    const ratings = await new PgRatingStore(pool).findAllForTenant(tenantId);
    const unchanged = ratings.find((r) => r.id === rating.id);
    expect(unchanged?.status).toBe("pending"); // moderation attempt from the wrong tenant had no effect

    await pool.query("delete from tenant where id = $1", [otherTenantId]);
  });

  /**
   * Regression coverage for the real gap that used to block
   * RatingController's moderate endpoint from producing a
   * notificationsForModeratedRating event: RatingStore had no findById to
   * look up a rating's own customerId/stars from just its id.
   */
  test("findById returns the real row's customerId/stars — what moderate() needs to fire a notification", async () => {
    const rating = await service.submit(tenantId, customerId, 1, randomUUID(), "Disappointing");
    const store = new PgRatingStore(pool);
    const found = await store.findById(tenantId, rating.id);
    expect(found?.customerId).toBe(customerId);
    expect(found?.stars).toBe(1);
  });

  test("findById is tenant-scoped, enforced by RLS", async () => {
    const otherTenantId = randomUUID();
    await pool.query("insert into tenant (id, name) values ($1, 'other tenant for findById')", [otherTenantId]);

    const rating = await service.submit(tenantId, customerId, 4, randomUUID());
    const store = new PgRatingStore(pool);
    expect(await store.findById(otherTenantId, rating.id)).toBeNull();

    await pool.query("delete from tenant where id = $1", [otherTenantId]);
  });

  test("hand-calculated aggregate matches the engine, computed from real rows", async () => {
    const isolatedTenantId = randomUUID();
    const isolatedCustomerId = randomUUID();
    await pool.query("insert into tenant (id, name) values ($1, 'isolated aggregate tenant')", [isolatedTenantId]);
    await runWithTenantContext(pool, isolatedTenantId, (client) =>
      client.query("insert into customer (id, tenant_id, display_name) values ($1, $2, 'Isolated customer')", [
        isolatedCustomerId,
        isolatedTenantId,
      ])
    );

    const r1 = await service.submit(isolatedTenantId, isolatedCustomerId, 5, randomUUID());
    const r2 = await service.submit(isolatedTenantId, isolatedCustomerId, 3, randomUUID());
    await service.moderate(isolatedTenantId, r1.id, "public");
    await service.moderate(isolatedTenantId, r2.id, "public");

    const agg = await service.aggregateForTenant(isolatedTenantId);
    expect(agg.count).toBe(2);
    expect(agg.averageStars).toBe(4);

    await pool.query("delete from tenant where id = $1", [isolatedTenantId]);
  });
});

import { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { PgSocialPostLogStore } from "./pg-social-post-log.store";
import { runWithTenantContext } from "../../common/postgres";

/**
 * REAL integration test against a live PostgreSQL instance — gated behind
 * TEST_DATABASE_URL, same pattern as every other Pg*Store test in this
 * project. Proves real RLS tenant scoping on social_post_log
 * (migration 0017_social_post_log.sql).
 */
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const maybeDescribe = TEST_DATABASE_URL ? describe : describe.skip;

maybeDescribe("PgSocialPostLogStore against a real PostgreSQL instance", () => {
  const pool = new Pool({ connectionString: TEST_DATABASE_URL });
  const store = new PgSocialPostLogStore(pool);
  const tenantId = randomUUID();

  beforeAll(async () => {
    await pool.query("insert into tenant (id, name) values ($1, 'PgSocialPostLogStore test tenant')", [tenantId]);
  });

  afterAll(async () => {
    await runWithTenantContext(pool, tenantId, (client) => client.query("delete from tenant where id = $1", [tenantId]));
    await pool.end();
  });

  test("save persists a real row, retrievable by findRecentForTenant", async () => {
    await store.save({ id: randomUUID(), tenantId, provider: "facebook", postId: "123_456", postedAt: new Date() });
    const recent = await store.findRecentForTenant(tenantId, new Date(Date.now() - 60 * 60 * 1000));
    expect(recent).toHaveLength(1);
    expect(recent[0].postId).toBe("123_456");
  });

  test("findRecentForTenant excludes posts older than sinceDate", async () => {
    const oneHourFromNow = new Date(Date.now() + 60 * 60 * 1000);
    const recent = await store.findRecentForTenant(tenantId, oneHourFromNow);
    expect(recent).toHaveLength(0);
  });

  test("findRecentForTenant is tenant-scoped, enforced by RLS", async () => {
    const otherTenantId = randomUUID();
    await pool.query("insert into tenant (id, name) values ($1, 'other tenant')", [otherTenantId]);
    await store.save({ id: randomUUID(), tenantId: otherTenantId, provider: "instagram", postId: "other-post", postedAt: new Date() });

    const recent = await store.findRecentForTenant(tenantId, new Date(Date.now() - 60 * 60 * 1000));
    expect(recent.every((e) => e.postId !== "other-post")).toBe(true);

    await runWithTenantContext(pool, otherTenantId, (client) => client.query("delete from tenant where id = $1", [otherTenantId]));
  });
});

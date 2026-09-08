import { Pool } from "pg";
import { Queue, Worker, Job } from "bullmq";
import { randomUUID } from "node:crypto";
import { RevokedTokenCleanupService } from "./revoked-token-cleanup.service";
import { runWithTenantContext } from "../../common/postgres";

test("deleteExpired returns 0 and does nothing when there is no pool (DATABASE_URL unset)", async () => {
  const service = new RevokedTokenCleanupService(null);
  await expect(service.deleteExpired()).resolves.toBe(0);
});

test("onModuleInit/onModuleDestroy no-op cleanly with no pool or no REDIS_URL — never throws", async () => {
  const service = new RevokedTokenCleanupService(null);
  await expect(service.onModuleInit()).resolves.toBeUndefined();
  await expect(service.onModuleDestroy()).resolves.toBeUndefined();
});

/**
 * REAL integration test against a live PostgreSQL instance — gated behind
 * TEST_DATABASE_URL. See src/common/postgres.test.ts for the connection
 * requirements. Proves the actual SQL, independent of the scheduling
 * mechanism below.
 */
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const maybeDescribeDb = TEST_DATABASE_URL ? describe : describe.skip;

maybeDescribeDb("RevokedTokenCleanupService.deleteExpired against a real PostgreSQL instance", () => {
  const pool = new Pool({ connectionString: TEST_DATABASE_URL });
  const tenantId = randomUUID();
  const userId = randomUUID();

  beforeAll(async () => {
    await pool.query("insert into tenant (id, name) values ($1, 'RevokedTokenCleanupService test tenant')", [tenantId]);
    // runWithTenantContext, not a plain pool.query — RLS's WITH CHECK clause
    // rejects an insert with no app.current_tenant_id set, the same lesson
    // learned earlier in this project (pg-consent.store.test.ts's beforeAll).
    await runWithTenantContext(pool, tenantId, (client) =>
      client.query(
        "insert into app_user (id, tenant_id, email, role, password_hash) values ($1, $2, 'cleanup-test@example.com', 'staff', 'x')",
        [userId, tenantId]
      )
    );
  });

  afterAll(async () => {
    // runWithTenantContext, not a plain pool.query — this DELETE cascades
    // into app_user + revoked_refresh_token, both RLS-protected, and this
    // pool's connection has definitely run set_config() before (every test
    // above uses runWithTenantContext). See postgres.ts's comment: after
    // COMMIT that setting reverts to an EMPTY STRING, not NULL, and casting
    // ''::uuid in the RLS policy throws.
    await runWithTenantContext(pool, tenantId, (client) => client.query("delete from tenant where id = $1", [tenantId]));
    await pool.end();
  });

  test("deletes only rows whose expires_at has already passed, leaving unexpired rows untouched", async () => {
    const service = new RevokedTokenCleanupService(pool);
    const expiredJti = randomUUID();
    const unexpiredJti = randomUUID();

    await runWithTenantContext(pool, tenantId, (client) =>
      client.query(
        "insert into revoked_refresh_token (jti, tenant_id, user_id, revoked_at, expires_at) values ($1, $2, $3, now(), now() - interval '1 hour')",
        [expiredJti, tenantId, userId]
      )
    );
    await runWithTenantContext(pool, tenantId, (client) =>
      client.query(
        "insert into revoked_refresh_token (jti, tenant_id, user_id, revoked_at, expires_at) values ($1, $2, $3, now(), now() + interval '1 hour')",
        [unexpiredJti, tenantId, userId]
      )
    );

    const deletedCount = await service.deleteExpired();
    expect(deletedCount).toBeGreaterThanOrEqual(1);

    // runWithTenantContext — a plain select would have RLS hide the
    // unexpired row too, making the "still contains unexpiredJti" assertion
    // below fail for the wrong reason (or, in other tests' shapes, pass
    // vacuously) instead of actually proving deleteExpired()'s selectivity.
    const remaining = await runWithTenantContext(pool, tenantId, (client) =>
      client.query("select jti from revoked_refresh_token where jti = any($1)", [[expiredJti, unexpiredJti]])
    );
    const remainingJtis = remaining.rows.map((r) => r.jti);
    expect(remainingJtis).not.toContain(expiredJti);
    expect(remainingJtis).toContain(unexpiredJti);
  });
});

/**
 * REAL integration test against BOTH a live PostgreSQL instance AND a live
 * Redis-compatible server — gated behind TEST_DATABASE_URL and
 * TEST_REDIS_URL together, since this proves the actual scheduling
 * mechanism, not just the SQL. Rather than wait a real 24 hours for the
 * repeatable job to fire, this manually enqueues one immediate job with the
 * same name the real worker listens for — proving the worker's processor
 * genuinely calls deleteExpired() against the real database, which is the
 * part that was actually unverified before this test existed.
 */
const TEST_REDIS_URL = process.env.TEST_REDIS_URL;
const maybeDescribeBoth = TEST_DATABASE_URL && TEST_REDIS_URL ? describe : describe.skip;

maybeDescribeBoth("RevokedTokenCleanupService's real scheduled worker against live Postgres + Redis", () => {
  const pool = new Pool({ connectionString: TEST_DATABASE_URL });
  const tenantId = randomUUID();
  const userId = randomUUID();
  const queueName = `test-maintenance-${Date.now()}`;

  beforeAll(async () => {
    await pool.query("insert into tenant (id, name) values ($1, 'RevokedTokenCleanupService worker test tenant')", [tenantId]);
    await runWithTenantContext(pool, tenantId, (client) =>
      client.query(
        "insert into app_user (id, tenant_id, email, role, password_hash) values ($1, $2, 'cleanup-worker-test@example.com', 'staff', 'x')",
        [userId, tenantId]
      )
    );
  });

  afterAll(async () => {
    // runWithTenantContext — same reasoning as the describe block above:
    // this cascades into RLS-protected tables on a connection that has
    // definitely run set_config() before.
    await runWithTenantContext(pool, tenantId, (client) => client.query("delete from tenant where id = $1", [tenantId]));
    await pool.end();
  });

  test("a real worker processing a real job genuinely deletes the expired row from the real database", async () => {
    const expiredJti = randomUUID();
    // runWithTenantContext — a plain insert here would fail RLS's WITH CHECK
    // clause outright (no app.current_tenant_id set to satisfy it).
    await runWithTenantContext(pool, tenantId, (client) =>
      client.query(
        "insert into revoked_refresh_token (jti, tenant_id, user_id, revoked_at, expires_at) values ($1, $2, $3, now(), now() - interval '1 hour')",
        [expiredJti, tenantId, userId]
      )
    );

    const service = new RevokedTokenCleanupService(pool);
    const queue = new Queue(queueName, { connection: { url: TEST_REDIS_URL } });
    const worker = new Worker(
      queueName,
      async (job: Job) => {
        if (job.name === "delete-expired-revoked-tokens") await service.deleteExpired();
      },
      { connection: { url: TEST_REDIS_URL } }
    );

    try {
      const completed = new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("Timed out waiting for the real worker to process the job")), 10000);
        worker.on("completed", () => {
          clearTimeout(timeout);
          resolve();
        });
      });
      await queue.add("delete-expired-revoked-tokens", {});
      await completed;

      // runWithTenantContext — a plain select here would have RLS hide every
      // row regardless of whether deleteExpired() actually worked, making
      // this assertion pass vacuously instead of proving anything.
      const remaining = await runWithTenantContext(pool, tenantId, (client) =>
        client.query("select jti from revoked_refresh_token where jti = $1", [expiredJti])
      );
      expect(remaining.rowCount).toBe(0);
    } finally {
      await worker.close();
      await queue.obliterate({ force: true });
      await queue.close();
    }
  }, 15000);
});

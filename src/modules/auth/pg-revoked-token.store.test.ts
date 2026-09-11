import { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { PgRevokedRefreshTokenStore } from "./pg-revoked-token.store";
import { PgAuthUserStore } from "./pg-auth-user.store";
import { AuthService } from "./auth.service";
import { hashPassword } from "./password";
import { runWithTenantContext } from "../../common/postgres";

/**
 * REAL integration test against a live PostgreSQL instance — gated behind
 * TEST_DATABASE_URL. See src/common/postgres.test.ts for the connection
 * requirements.
 */
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const maybeDescribe = TEST_DATABASE_URL ? describe : describe.skip;

maybeDescribe("PgRevokedRefreshTokenStore against a real PostgreSQL instance", () => {
  const pool = new Pool({ connectionString: TEST_DATABASE_URL });
  const tenantId = randomUUID();
  const userId = randomUUID();

  beforeAll(async () => {
    await pool.query("insert into tenant (id, name) values ($1, 'PgRevokedRefreshTokenStore test tenant')", [tenantId]);
    // runWithTenantContext, not a plain pool.query — RLS's WITH CHECK clause
    // rejects an insert with no app.current_tenant_id set, the same lesson
    // learned the hard way in pg-consent.store.test.ts's beforeAll.
    await runWithTenantContext(pool, tenantId, (client) =>
      client.query(
        "insert into app_user (id, tenant_id, email, role, password_hash) values ($1, $2, 'revoke-test@example.com', 'staff', 'x')",
        [userId, tenantId]
      )
    );
  });

  afterAll(async () => {
    // runWithTenantContext — this DELETE cascades into RLS-protected
    // app_user/revoked_refresh_token rows on a connection that has run
    // set_config() before; see postgres.ts's comment on the
    // empty-string-after-commit footgun a plain pool.query() would hit here.
    await runWithTenantContext(pool, tenantId, (client) => client.query("delete from tenant where id = $1", [tenantId]));
    await pool.end();
  });

  test("a jti is not revoked until revoke() is actually called", async () => {
    const store = new PgRevokedRefreshTokenStore(pool);
    const jti = randomUUID();
    expect(await store.isRevoked(tenantId, jti)).toBe(false);
  });

  test("revoke() persists a real row, and isRevoked() genuinely reflects it afterward", async () => {
    const store = new PgRevokedRefreshTokenStore(pool);
    const jti = randomUUID();
    const expiresAt = new Date(Date.now() + 60_000);

    await store.revoke(tenantId, userId, jti, expiresAt);
    expect(await store.isRevoked(tenantId, jti)).toBe(true);
  });

  test("revoke() is idempotent — calling it twice for the same jti does not error", async () => {
    const store = new PgRevokedRefreshTokenStore(pool);
    const jti = randomUUID();
    const expiresAt = new Date(Date.now() + 60_000);

    await store.revoke(tenantId, userId, jti, expiresAt);
    await store.revoke(tenantId, userId, jti, expiresAt); // must not throw a duplicate-key error
    expect(await store.isRevoked(tenantId, jti)).toBe(true);
  });

  test("isRevoked() is tenant-scoped, enforced by RLS", async () => {
    const store = new PgRevokedRefreshTokenStore(pool);
    const jti = randomUUID();
    await store.revoke(tenantId, userId, jti, new Date(Date.now() + 60_000));

    const otherTenantId = randomUUID();
    await pool.query("insert into tenant (id, name) values ($1, 'other tenant')", [otherTenantId]);
    expect(await store.isRevoked(otherTenantId, jti)).toBe(false); // real row exists, but not visible from the wrong tenant context

    await runWithTenantContext(pool, otherTenantId, (client) => client.query("delete from tenant where id = $1", [otherTenantId]));
  });

  /**
   * The actual end-to-end proof this store exists for: a live login →
   * refresh → refresh-again-with-the-same-token cycle, run entirely through
   * AuthService against the real database, exactly the behavior already
   * unit-tested in auth.service.test.ts but now proving RLS doesn't silently
   * defeat it the way it did for Consent/Rating/AuthUser before their
   * Pg*Store equivalents threaded tenantId through.
   */
  test("a rotated-away refresh token is genuinely rejected on reuse, backed by a real database row", async () => {
    const authUserStore = new PgAuthUserStore(pool);
    const jwtSecret = "pg-revoked-token-test-secret";
    const authService = new AuthService(authUserStore, jwtSecret, new PgRevokedRefreshTokenStore(pool), "test-mfa-key");

    const email = `revoke-flow-${randomUUID()}@example.com`;
    await authUserStore.save({
      id: randomUUID(),
      tenantId,
      email,
      role: "staff",
      passwordHash: await hashPassword("password123"),
      mfaEnabled: false,
      isActive: true,
      createdAt: new Date(),
      emailVerified: true,
    });

    const tokens = await authService.login(tenantId, email, "password123");
    const rotated = await authService.refresh(tokens.refreshToken);
    expect(rotated.accessToken).toBeTruthy();

    // The original refresh token was revoked by that refresh() call — a real
    // row now exists in revoked_refresh_token, not just an in-memory flag.
    await expect(authService.refresh(tokens.refreshToken)).rejects.toThrow("Refresh token has been revoked");
  });
});

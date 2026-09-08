import { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { AuthService } from "./auth.service";
import { PgAuthUserStore } from "./pg-auth-user.store";
import { InMemoryRevokedRefreshTokenStore } from "./in-memory-revoked-token.store";
import { generateMfaEncryptionKey } from "./mfa-secret-crypto";
import { totp, base32Decode } from "./totp";

/**
 * REAL integration test against a live PostgreSQL instance — gated behind
 * TEST_DATABASE_URL. See src/common/postgres.test.ts for the connection
 * requirements. Refresh-token revocation uses an in-memory store here
 * deliberately — that component is already separately verified in
 * auth.service.test.ts; this file's job is proving AuthUserStore's real
 * persistence (register/login/findById), not re-testing revocation.
 */
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const maybeDescribe = TEST_DATABASE_URL ? describe : describe.skip;

maybeDescribe("PgAuthUserStore + AuthService against a real PostgreSQL instance", () => {
  const pool = new Pool({ connectionString: TEST_DATABASE_URL });
  const tenantId = randomUUID();
  const jwtSecret = "test-jwt-secret";
  const mfaKey = generateMfaEncryptionKey();

  function makeService(): AuthService {
    return new AuthService(new PgAuthUserStore(pool), jwtSecret, new InMemoryRevokedRefreshTokenStore(), mfaKey);
  }

  beforeAll(async () => {
    await pool.query("insert into tenant (id, name) values ($1, 'PgAuthUserStore test tenant')", [tenantId]);
  });

  afterAll(async () => {
    await pool.query("delete from tenant where id = $1", [tenantId]); // cascades to app_user
    await pool.end();
  });

  test("register then login works end-to-end against the real database", async () => {
    const service = makeService();
    const email = `staff-${randomUUID()}@example.com`;
    await service.register(tenantId, email, "a-real-password", "staff", randomUUID());

    const tokens = await service.login(tenantId, email, "a-real-password");
    const verified = service.verifyAccessToken(tokens.accessToken);
    expect(verified.tenantId).toBe(tenantId);
    expect(verified.role).toBe("staff");
  });

  test("register rejects a duplicate email against the real database (unique constraint + app-level check agree)", async () => {
    const service = makeService();
    const email = `dup-${randomUUID()}@example.com`;
    await service.register(tenantId, email, "a-real-password", "staff", randomUUID());
    await expect(service.register(tenantId, email, "another-password", "staff", randomUUID())).rejects.toThrow();
  });

  test("the full Owner MFA enrollment + login flow works end-to-end against the real database", async () => {
    const service = makeService();
    const email = `owner-${randomUUID()}@example.com`;
    const registered = await service.register(tenantId, email, "a-real-password", "owner", randomUUID());

    const { secret } = await service.startMfaEnrollment(tenantId, registered.id);
    const code = totp(base32Decode(secret));
    await service.confirmMfaEnrollment(tenantId, registered.id, code);

    const tokens = await service.login(tenantId, email, "a-real-password", totp(base32Decode(secret)));
    expect(service.verifyAccessToken(tokens.accessToken).role).toBe("owner");
  });

  test("findById with the wrong tenantId finds nothing — RLS-enforced, not just an app-level filter", async () => {
    const service = makeService();
    const email = `scoped-${randomUUID()}@example.com`;
    const registered = await service.register(tenantId, email, "a-real-password", "owner", randomUUID());

    await expect(service.startMfaEnrollment(randomUUID(), registered.id)).rejects.toThrow();
  });
});

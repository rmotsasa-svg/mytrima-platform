import { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { TenantService } from "./tenant.service";
import { PgTenantStore } from "./pg-tenant.store";
import { AuthService } from "./auth.service";
import { PgAuthUserStore } from "./pg-auth-user.store";
import { InMemoryRevokedRefreshTokenStore } from "./in-memory-revoked-token.store";
import { totp, base32Decode } from "./totp";
import { generateMfaEncryptionKey } from "./mfa-secret-crypto";
import { runWithTenantContext } from "../../common/postgres";

/**
 * REAL integration test against a live PostgreSQL instance — gated behind
 * TEST_DATABASE_URL. Proves registerTenant() genuinely creates a real
 * `tenant` row (no RLS — see PgTenantStore's own comment) that a real
 * `app_user` row can then satisfy its foreign key against, end to end
 * through a real login.
 */
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const maybeDescribe = TEST_DATABASE_URL ? describe : describe.skip;

maybeDescribe("PgTenantStore + TenantService against a real PostgreSQL instance", () => {
  const pool = new Pool({ connectionString: TEST_DATABASE_URL });
  const authService = new AuthService(new PgAuthUserStore(pool), "pg-tenant-test-secret", new InMemoryRevokedRefreshTokenStore(), generateMfaEncryptionKey());
  const tenantService = new TenantService(new PgTenantStore(pool), authService);
  let createdTenantId: string | undefined;

  afterAll(async () => {
    if (createdTenantId) {
      await runWithTenantContext(pool, createdTenantId, (client) => client.query("delete from tenant where id = $1", [createdTenantId]));
    }
    await pool.end();
  });

  test("registerTenant persists a real tenant row and a real owner app_user row that can log in after enrolling MFA", async () => {
    const email = `real-owner-${randomUUID()}@example.com`;
    const result = await tenantService.registerTenant("Real New Business", email, "a-real-password");
    createdTenantId = result.tenantId;

    // Same real behavior as auth/tenant.service.test.ts's in-memory
    // equivalent: AuthService.login() correctly requires an owner to have
    // enrolled MFA first.
    const enrollment = await authService.startMfaEnrollment(result.tenantId, result.owner.id);
    const code = totp(base32Decode(enrollment.secret));
    await authService.confirmMfaEnrollment(result.tenantId, result.owner.id, code);

    const tokens = await authService.login(result.tenantId, email, "a-real-password", totp(base32Decode(enrollment.secret)));
    expect(authService.verifyAccessToken(tokens.accessToken).role).toBe("owner");
  }, 15000); // 5 sequential real Postgres round-trips (create tenant, register, enroll, confirm, login) — genuinely tight against Jest's default 5s timeout under parallel test load, not a bug; same accommodation notification-worker.service.test.ts already makes for its own multi-step real-infrastructure test.
});

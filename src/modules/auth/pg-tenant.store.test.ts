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
import { ConsoleEmailService } from "../integrations/email/email.service";

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
  const tenantService = new TenantService(new PgTenantStore(pool), authService, new ConsoleEmailService());
  const createdTenantIds: string[] = [];

  afterAll(async () => {
    for (const id of createdTenantIds) {
      await runWithTenantContext(pool, id, (client) => client.query("delete from tenant where id = $1", [id]));
    }
    await pool.end();
  });

  test("registerTenant persists a real tenant row and a real owner app_user row that can log in after verifying email and enrolling MFA", async () => {
    const email = `real-owner-${randomUUID()}@example.com`;
    const result = await tenantService.registerTenant("Real New Business", email, "a-real-password");
    createdTenantIds.push(result.tenantId);

    // A brand-new self-serve owner cannot log in at all yet — real,
    // Postgres-backed proof of the same real EmailNotVerifiedError gap
    // auth.service.test.ts's in-memory equivalent already proves.
    await expect(authService.login(result.tenantId, email, "a-real-password")).rejects.toThrow("verify your email");

    // Simulates clicking the real link this registerTenant() call actually
    // emailed (ConsoleEmailService logs it rather than sending it in this
    // test run) — a fresh token, not the one from that log line, since
    // this test only cares that verifyEmailAddress() genuinely flips the
    // real column, not that it can scrape its own console output.
    const verificationToken = authService.issueEmailVerificationToken(result.tenantId, result.owner.id);
    await authService.verifyEmailAddress(verificationToken);

    // Same real behavior as auth/tenant.service.test.ts's in-memory
    // equivalent: AuthService.login() correctly requires an owner to have
    // enrolled MFA first.
    const enrollment = await authService.startMfaEnrollment(result.tenantId, result.owner.id);
    const code = totp(base32Decode(enrollment.secret));
    await authService.confirmMfaEnrollment(result.tenantId, result.owner.id, code);

    const tokens = await authService.login(result.tenantId, email, "a-real-password", totp(base32Decode(enrollment.secret)));
    expect(authService.verifyAccessToken(tokens.accessToken).role).toBe("owner");
  }, 15000); // 7 sequential real Postgres round-trips (create tenant, register, rejected login, verify email, enroll, confirm, login) — genuinely tight against Jest's default 5s timeout under parallel test load, not a bug; same accommodation notification-worker.service.test.ts already makes for its own multi-step real-infrastructure test.

  test("findById returns null for a nonexistent tenant, then setNotificationPhone + findById round-trip a real phone number", async () => {
    const store = new PgTenantStore(pool);
    expect(await store.findById(randomUUID())).toBeNull();

    const { tenantId } = await tenantService.registerTenant("Notification Phone Test Biz", `owner-${randomUUID()}@example.com`, "a-real-password");
    createdTenantIds.push(tenantId);

    const beforeSet = await store.findById(tenantId);
    expect(beforeSet?.notificationPhoneE164).toBeUndefined();

    await tenantService.setNotificationPhone(tenantId, "+26612345678");
    const afterSet = await store.findById(tenantId);
    expect(afterSet?.notificationPhoneE164).toBe("+26612345678");
  });

  test("setPayfastMerchantId + findById round-trip a real PayFast merchant id", async () => {
    const store = new PgTenantStore(pool);
    const { tenantId } = await tenantService.registerTenant("PayFast Merchant Id Test Biz", `owner-${randomUUID()}@example.com`, "a-real-password");
    createdTenantIds.push(tenantId);

    expect((await store.findById(tenantId))?.payfastMerchantId).toBeUndefined();

    await tenantService.setPayfastMerchantId(tenantId, "10000100");
    expect((await store.findById(tenantId))?.payfastMerchantId).toBe("10000100");
  });

  test("setBusinessProfile + findById round-trip real business-profile fields, and a partial update only touches the field it names (migration 0024)", async () => {
    const store = new PgTenantStore(pool);
    const { tenantId } = await tenantService.registerTenant("Business Profile Test Biz", `owner-${randomUUID()}@example.com`, "a-real-password");
    createdTenantIds.push(tenantId);

    expect((await store.findById(tenantId))?.industry).toBeUndefined();

    await tenantService.setBusinessProfile(tenantId, {
      description: "A real hardware store in Maseru.",
      industry: "Retail",
      location: "Maseru, Lesotho",
      contactEmail: "hello@realbiz.example.com",
      contactPhone: "+26612345678",
      businessGoal: "Open a second location within 18 months",
    });
    const afterFullSet = await store.findById(tenantId);
    expect(afterFullSet?.description).toBe("A real hardware store in Maseru.");
    expect(afterFullSet?.industry).toBe("Retail");
    expect(afterFullSet?.location).toBe("Maseru, Lesotho");
    expect(afterFullSet?.contactEmail).toBe("hello@realbiz.example.com");
    expect(afterFullSet?.contactPhone).toBe("+26612345678");
    expect(afterFullSet?.businessGoal).toBe("Open a second location within 18 months");

    // A real SQL bug this dynamic-SET-clause approach could plausibly have:
    // overwriting every column with null instead of building a SET clause
    // for only the named key. Proven wrong against a real UPDATE, not just
    // the in-memory store's own object-spread (which can't have this bug
    // class at all).
    await tenantService.setBusinessProfile(tenantId, { industry: "Hardware & building supplies" });
    const afterPartialUpdate = await store.findById(tenantId);
    expect(afterPartialUpdate?.industry).toBe("Hardware & building supplies");
    expect(afterPartialUpdate?.description).toBe("A real hardware store in Maseru.");
    expect(afterPartialUpdate?.location).toBe("Maseru, Lesotho");
  });
});

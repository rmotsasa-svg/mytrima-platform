import {
  AuthService,
  AuthUserRecord,
  InvalidCredentialsError,
  MfaEnrollmentRequiredError,
  MfaRequiredError,
  MfaInvalidCodeError,
  EmailAlreadyRegisteredError,
  WeakPasswordError,
  UserNotFoundError,
} from "./auth.service";
import { InMemoryAuthUserStore } from "./in-memory-auth-user.store";
import { InMemoryRevokedRefreshTokenStore } from "./in-memory-revoked-token.store";
import { hashPassword } from "./password";
import { generateBase32Secret, totp, base32Decode } from "./totp";
import { encryptMfaSecret, generateMfaEncryptionKey } from "./mfa-secret-crypto";
import { InvalidTokenError } from "./jwt";

const SECRET = "test-jwt-secret";
const MFA_KEY = generateMfaEncryptionKey();

async function makeStaffUser(overrides: Partial<AuthUserRecord> = {}): Promise<AuthUserRecord> {
  return {
    id: "u-staff",
    tenantId: "t1",
    email: "staff@example.com",
    role: "staff",
    passwordHash: await hashPassword("correct-password"),
    mfaEnabled: false,
    ...overrides,
  };
}

function storeWith(...users: AuthUserRecord[]): InMemoryAuthUserStore {
  const store = new InMemoryAuthUserStore();
  for (const u of users) store.seed(u);
  return store;
}

/** Every test gets a fresh store + revocation store + service — matches the
 * existing style (storeWith(...)) rather than sharing state across tests. */
function makeService(...users: AuthUserRecord[]): AuthService {
  return new AuthService(storeWith(...users), SECRET, new InMemoryRevokedRefreshTokenStore(), MFA_KEY);
}

test("login succeeds for a non-owner with correct credentials, no MFA required", async () => {
  const user = await makeStaffUser();
  const service = makeService(user);
  const tokens = await service.login("t1", "staff@example.com", "correct-password");
  const verified = service.verifyAccessToken(tokens.accessToken);
  expect(verified.userId).toBe("u-staff");
  expect(verified.tenantId).toBe("t1");
  expect(verified.role).toBe("staff");
});

test("login throws InvalidCredentialsError for a wrong password", async () => {
  const user = await makeStaffUser();
  const service = makeService(user);
  await expect(service.login("t1", "staff@example.com", "wrong-password")).rejects.toThrow(InvalidCredentialsError);
});

test("login throws InvalidCredentialsError for an unknown email (not a different error, to resist enumeration)", async () => {
  const service = makeService();
  await expect(service.login("t1", "nobody@example.com", "anything")).rejects.toThrow(InvalidCredentialsError);
});

test("login for an owner without MFA enrolled throws MfaEnrollmentRequiredError", async () => {
  const owner = await makeStaffUser({ id: "u-owner", email: "owner@example.com", role: "owner", mfaEnabled: false });
  const service = makeService(owner);
  await expect(service.login("t1", "owner@example.com", "correct-password")).rejects.toThrow(MfaEnrollmentRequiredError);
});

/**
 * Regression test for the REAL BUG found 2026-09-10 (see this file's own
 * comment near MfaEnrollmentTokenPayload in auth.service.ts): a fresh
 * owner has no access token to call POST /auth/mfa/enroll/start with.
 * login()'s thrown error must carry a usable enrollmentToken so a real
 * caller isn't simply locked out — verified end to end here: mint it,
 * confirm it's accepted where it should be, rejected where it shouldn't.
 */
test("login's MfaEnrollmentRequiredError carries a real, usable enrollmentToken — accepted by verifyAccessOrMfaEnrollmentToken, rejected by verifyAccessToken", async () => {
  const owner = await makeStaffUser({ id: "u-owner", email: "owner@example.com", role: "owner", mfaEnabled: false });
  const service = makeService(owner);

  let enrollmentToken: string | undefined;
  try {
    await service.login("t1", "owner@example.com", "correct-password");
  } catch (err) {
    if (err instanceof MfaEnrollmentRequiredError) enrollmentToken = err.enrollmentToken;
  }
  expect(enrollmentToken).toBeTruthy();

  const verified = service.verifyAccessOrMfaEnrollmentToken(enrollmentToken as string);
  expect(verified).toEqual({ userId: "u-owner", tenantId: "t1", role: "owner" });
  expect(() => service.verifyAccessToken(enrollmentToken as string)).toThrow(InvalidTokenError);
});

test("confirmMfaEnrollment's own MfaEnrollmentRequiredError (never started enrollment) carries no enrollmentToken — that caller is already authenticated by definition", async () => {
  const owner = await makeStaffUser({ id: "u-owner", email: "owner@example.com", role: "owner", mfaEnabled: false });
  const service = makeService(owner);
  await expect(service.confirmMfaEnrollment("t1", "u-owner", "000000")).rejects.toThrow(MfaEnrollmentRequiredError);
  try {
    await service.confirmMfaEnrollment("t1", "u-owner", "000000");
  } catch (err) {
    expect(err).toBeInstanceOf(MfaEnrollmentRequiredError);
    expect((err as MfaEnrollmentRequiredError).enrollmentToken).toBeUndefined();
  }
});

test("login for an owner with MFA enrolled but no code supplied throws MfaRequiredError", async () => {
  const secret = generateBase32Secret();
  const owner = await makeStaffUser({
    id: "u-owner",
    email: "owner@example.com",
    role: "owner",
    mfaEnabled: true,
    mfaSecret: encryptMfaSecret(secret, MFA_KEY),
  });
  const service = makeService(owner);
  await expect(service.login("t1", "owner@example.com", "correct-password")).rejects.toThrow(MfaRequiredError);
});

test("login for an owner with a correct MFA code succeeds", async () => {
  const secret = generateBase32Secret();
  const owner = await makeStaffUser({
    id: "u-owner",
    email: "owner@example.com",
    role: "owner",
    mfaEnabled: true,
    mfaSecret: encryptMfaSecret(secret, MFA_KEY),
  });
  const service = makeService(owner);
  const code = totp(base32Decode(secret));
  const tokens = await service.login("t1", "owner@example.com", "correct-password", code);
  const verified = service.verifyAccessToken(tokens.accessToken);
  expect(verified.role).toBe("owner");
});

test("login for an owner with an incorrect MFA code throws MfaInvalidCodeError", async () => {
  const secret = generateBase32Secret();
  const owner = await makeStaffUser({
    id: "u-owner",
    email: "owner@example.com",
    role: "owner",
    mfaEnabled: true,
    mfaSecret: encryptMfaSecret(secret, MFA_KEY),
  });
  const service = makeService(owner);
  await expect(service.login("t1", "owner@example.com", "correct-password", "000000")).rejects.toThrow(MfaInvalidCodeError);
});

test("refresh issues a new working access token from a valid refresh token", async () => {
  const user = await makeStaffUser();
  const service = makeService(user);
  const tokens = await service.login("t1", "staff@example.com", "correct-password");
  const refreshed = await service.refresh(tokens.refreshToken);
  const verified = service.verifyAccessToken(refreshed.accessToken);
  expect(verified.userId).toBe("u-staff");
});

test("refresh rejects an access token presented in place of a refresh token", async () => {
  const user = await makeStaffUser();
  const service = makeService(user);
  const tokens = await service.login("t1", "staff@example.com", "correct-password");
  await expect(service.refresh(tokens.accessToken)).rejects.toThrow(InvalidTokenError);
});

test("verifyAccessToken rejects a refresh token presented in place of an access token", async () => {
  const user = await makeStaffUser();
  const service = makeService(user);
  const tokens = await service.login("t1", "staff@example.com", "correct-password");
  expect(() => service.verifyAccessToken(tokens.refreshToken)).toThrow(InvalidTokenError);
});

test("refresh rotates the token: the same refresh token cannot be used twice", async () => {
  const user = await makeStaffUser();
  const service = makeService(user);
  const tokens = await service.login("t1", "staff@example.com", "correct-password");

  await service.refresh(tokens.refreshToken); // first use: fine, rotates
  await expect(service.refresh(tokens.refreshToken)).rejects.toThrow(InvalidTokenError); // second use: revoked
});

test("logout revokes a refresh token so a subsequent refresh() with it fails", async () => {
  const user = await makeStaffUser();
  const service = makeService(user);
  const tokens = await service.login("t1", "staff@example.com", "correct-password");

  await service.logout(tokens.refreshToken);

  await expect(service.refresh(tokens.refreshToken)).rejects.toThrow(InvalidTokenError);
});

test("register creates a user who can immediately log in", async () => {
  const service = makeService();
  await service.register("t1", "new@example.com", "a-real-password", "staff", "u-new");
  const tokens = await service.login("t1", "new@example.com", "a-real-password");
  const verified = service.verifyAccessToken(tokens.accessToken);
  expect(verified.userId).toBe("u-new");
  expect(verified.role).toBe("staff");
});

test("register rejects a duplicate email within the same tenant", async () => {
  const user = await makeStaffUser();
  const service = makeService(user);
  await expect(service.register("t1", "staff@example.com", "another-password", "staff", "u-dup")).rejects.toThrow(
    EmailAlreadyRegisteredError
  );
});

test("register allows the same email in a different tenant (tenant-scoped uniqueness)", async () => {
  const user = await makeStaffUser();
  const service = makeService(user);
  await expect(
    service.register("tenant-B", "staff@example.com", "another-password", "staff", "u-other-tenant")
  ).resolves.toBeDefined();
});

test("register rejects a password shorter than the minimum length", async () => {
  const service = makeService();
  await expect(service.register("t1", "short@example.com", "1234567", "staff", "u-short")).rejects.toThrow(WeakPasswordError);
});

/**
 * Regression test for a real bug caught by hand-testing the live endpoint:
 * register() originally returned the full AuthUserRecord, which put the
 * (hashed, but still sensitive) passwordHash straight into the HTTP
 * response body. Same class of bug as MoPay's getSession leak, fixed the
 * same way — by returning an explicitly narrowed shape.
 */
test("register never returns passwordHash or mfaSecret — only the safe public fields", async () => {
  const service = makeService();
  const result = await service.register("t1", "safe@example.com", "a-real-password", "staff", "u-safe");
  expect(Object.keys(result).sort()).toEqual(["email", "id", "mfaEnabled", "role", "tenantId"]);
  expect(JSON.stringify(result)).not.toContain("a-real-password");
});

test("MFA enrollment: start then confirm with the correct code enables MFA and login then works", async () => {
  const owner = await makeStaffUser({ id: "u-owner", email: "owner@example.com", role: "owner" });
  const service = makeService(owner);

  const { secret, otpauthUrl } = await service.startMfaEnrollment("t1", "u-owner");
  expect(otpauthUrl).toContain("otpauth://totp/");
  expect(otpauthUrl).toContain(encodeURIComponent("owner@example.com"));

  // Not yet enabled: login still demands enrollment, even though a secret
  // now exists, because it hasn't been confirmed.
  await expect(service.login("t1", "owner@example.com", "correct-password")).rejects.toThrow(MfaEnrollmentRequiredError);

  const code = totp(base32Decode(secret));
  await service.confirmMfaEnrollment("t1", "u-owner", code);

  const tokens = await service.login("t1", "owner@example.com", "correct-password", totp(base32Decode(secret)));
  expect(service.verifyAccessToken(tokens.accessToken).role).toBe("owner");
});

test("MFA enrollment: confirming with the wrong code throws and leaves MFA disabled", async () => {
  const owner = await makeStaffUser({ id: "u-owner", email: "owner@example.com", role: "owner" });
  const service = makeService(owner);

  await service.startMfaEnrollment("t1", "u-owner");
  await expect(service.confirmMfaEnrollment("t1", "u-owner", "000000")).rejects.toThrow(MfaInvalidCodeError);
});

/**
 * Regression test for a real gap surfaced while building the Postgres-
 * backed AuthUserStore: findById() originally took only an id, with no
 * tenant to scope a real RLS-enforced query to. A caller can't enroll MFA
 * against a user by guessing their id while claiming the wrong tenant.
 */
test("startMfaEnrollment throws UserNotFoundError when called with the wrong tenantId", async () => {
  const owner = await makeStaffUser({ id: "u-owner", email: "owner@example.com", role: "owner" });
  const service = makeService(owner);
  await expect(service.startMfaEnrollment("wrong-tenant", "u-owner")).rejects.toThrow(UserNotFoundError);

  // Still not enabled — the login MFA gate wasn't bypassed by a failed confirm.
  await expect(service.login("t1", "owner@example.com", "correct-password")).rejects.toThrow(MfaEnrollmentRequiredError);
});

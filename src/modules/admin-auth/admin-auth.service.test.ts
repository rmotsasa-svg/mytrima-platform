import {
  AdminAuthService,
  AdminUserRecord,
  AdminInvalidCredentialsError,
  AdminMfaEnrollmentRequiredError,
  AdminMfaRequiredError,
  AdminMfaInvalidCodeError,
  AdminEmailAlreadyRegisteredError,
  AdminWeakPasswordError,
  AdminUserNotFoundError,
  AdminAccountDeactivatedError,
  CannotRemoveLastAdminError,
  AdminBootstrapAlreadyCompleteError,
} from "./admin-auth.service";
import { InMemoryAdminUserStore } from "./in-memory-admin-user.store";
import { InMemoryAdminRevokedRefreshTokenStore } from "./in-memory-admin-revoked-token.store";
import { hashPassword } from "../auth/password";
import { generateBase32Secret, totp, base32Decode } from "../auth/totp";
import { encryptMfaSecret, generateMfaEncryptionKey } from "../auth/mfa-secret-crypto";
import { InvalidTokenError } from "../auth/jwt";

const SECRET = "test-jwt-secret";
const MFA_KEY = generateMfaEncryptionKey();

async function makeAdminUser(overrides: Partial<AdminUserRecord> = {}): Promise<AdminUserRecord> {
  return {
    id: "a-1",
    email: "admin@example.com",
    passwordHash: await hashPassword("correct-password"),
    mfaEnabled: false,
    isActive: true,
    createdAt: new Date(),
    ...overrides,
  };
}

async function storeWith(...users: AdminUserRecord[]): Promise<InMemoryAdminUserStore> {
  const store = new InMemoryAdminUserStore();
  for (const u of users) await store.save(u);
  return store;
}

async function makeService(...users: AdminUserRecord[]): Promise<AdminAuthService> {
  return new AdminAuthService(await storeWith(...users), SECRET, new InMemoryAdminRevokedRefreshTokenStore(), MFA_KEY);
}

/* ---------- login / MFA — mandatory for every admin, no role branch ---------- */

test("login for an admin without MFA enrolled throws AdminMfaEnrollmentRequiredError — unconditional, unlike tenant login's owner-only gate", async () => {
  const admin = await makeAdminUser();
  const service = await makeService(admin);
  await expect(service.login("admin@example.com", "correct-password")).rejects.toThrow(AdminMfaEnrollmentRequiredError);
});

test("login's AdminMfaEnrollmentRequiredError carries a real, usable enrollmentToken — accepted by verifyAccessOrMfaEnrollmentToken, rejected by verifyAccessToken", async () => {
  const admin = await makeAdminUser();
  const service = await makeService(admin);

  let enrollmentToken: string | undefined;
  try {
    await service.login("admin@example.com", "correct-password");
  } catch (err) {
    if (err instanceof AdminMfaEnrollmentRequiredError) enrollmentToken = err.enrollmentToken;
  }
  expect(enrollmentToken).toBeTruthy();

  const verified = service.verifyAccessOrMfaEnrollmentToken(enrollmentToken as string);
  expect(verified).toEqual({ adminUserId: "a-1" });
  expect(() => service.verifyAccessToken(enrollmentToken as string)).toThrow(InvalidTokenError);
});

test("login throws AdminInvalidCredentialsError for a wrong password", async () => {
  const admin = await makeAdminUser();
  const service = await makeService(admin);
  await expect(service.login("admin@example.com", "wrong-password")).rejects.toThrow(AdminInvalidCredentialsError);
});

test("login throws AdminInvalidCredentialsError for an unknown email (not a different error, to resist enumeration)", async () => {
  const service = await makeService();
  await expect(service.login("nobody@example.com", "anything")).rejects.toThrow(AdminInvalidCredentialsError);
});

test("login rejects a deactivated admin with a real password, distinctly from a wrong password", async () => {
  const admin = await makeAdminUser({ isActive: false });
  const service = await makeService(admin);
  await expect(service.login("admin@example.com", "correct-password")).rejects.toThrow(AdminAccountDeactivatedError);
});

test("login for an admin with MFA enrolled but no code supplied throws AdminMfaRequiredError", async () => {
  const secret = generateBase32Secret();
  const admin = await makeAdminUser({ mfaEnabled: true, mfaSecret: encryptMfaSecret(secret, MFA_KEY) });
  const service = await makeService(admin);
  await expect(service.login("admin@example.com", "correct-password")).rejects.toThrow(AdminMfaRequiredError);
});

test("login for an admin with a correct MFA code succeeds", async () => {
  const secret = generateBase32Secret();
  const admin = await makeAdminUser({ mfaEnabled: true, mfaSecret: encryptMfaSecret(secret, MFA_KEY) });
  const service = await makeService(admin);
  const code = totp(base32Decode(secret));
  const tokens = await service.login("admin@example.com", "correct-password", code);
  const verified = service.verifyAccessToken(tokens.accessToken);
  expect(verified.adminUserId).toBe("a-1");
});

test("login for an admin with an incorrect MFA code throws AdminMfaInvalidCodeError", async () => {
  const secret = generateBase32Secret();
  const admin = await makeAdminUser({ mfaEnabled: true, mfaSecret: encryptMfaSecret(secret, MFA_KEY) });
  const service = await makeService(admin);
  await expect(service.login("admin@example.com", "correct-password", "000000")).rejects.toThrow(AdminMfaInvalidCodeError);
});

/* ---------- MFA enrollment ---------- */

test("MFA enrollment: start then confirm with the correct code enables MFA and login then works", async () => {
  const admin = await makeAdminUser();
  const service = await makeService(admin);

  const { secret } = await service.startMfaEnrollment("a-1");
  const code = totp(base32Decode(secret));
  await service.confirmMfaEnrollment("a-1", code);

  const tokens = await service.login("admin@example.com", "correct-password", code);
  expect(service.verifyAccessToken(tokens.accessToken).adminUserId).toBe("a-1");
});

test("MFA enrollment: confirming with the wrong code throws and leaves MFA disabled", async () => {
  const admin = await makeAdminUser();
  const service = await makeService(admin);
  await service.startMfaEnrollment("a-1");
  await expect(service.confirmMfaEnrollment("a-1", "000000")).rejects.toThrow(AdminMfaInvalidCodeError);
  await expect(service.login("admin@example.com", "correct-password")).rejects.toThrow(AdminMfaEnrollmentRequiredError);
});

test("confirmMfaEnrollment's own AdminMfaEnrollmentRequiredError (never started enrollment) carries no enrollmentToken — that caller is already authenticated by definition", async () => {
  const admin = await makeAdminUser();
  const service = await makeService(admin);
  try {
    await service.confirmMfaEnrollment("a-1", "000000");
  } catch (err) {
    expect(err).toBeInstanceOf(AdminMfaEnrollmentRequiredError);
    expect((err as AdminMfaEnrollmentRequiredError).enrollmentToken).toBeUndefined();
  }
});

/* ---------- refresh / logout ---------- */

test("refresh issues a new working access token from a valid refresh token", async () => {
  const secret = generateBase32Secret();
  const admin = await makeAdminUser({ mfaEnabled: true, mfaSecret: encryptMfaSecret(secret, MFA_KEY) });
  const service = await makeService(admin);
  const tokens = await service.login("admin@example.com", "correct-password", totp(base32Decode(secret)));
  const refreshed = await service.refresh(tokens.refreshToken);
  expect(service.verifyAccessToken(refreshed.accessToken).adminUserId).toBe("a-1");
});

test("refresh rotates the token: the same refresh token cannot be used twice", async () => {
  const secret = generateBase32Secret();
  const admin = await makeAdminUser({ mfaEnabled: true, mfaSecret: encryptMfaSecret(secret, MFA_KEY) });
  const service = await makeService(admin);
  const tokens = await service.login("admin@example.com", "correct-password", totp(base32Decode(secret)));

  await service.refresh(tokens.refreshToken);
  await expect(service.refresh(tokens.refreshToken)).rejects.toThrow(InvalidTokenError);
});

test("logout revokes a refresh token so a subsequent refresh() with it fails", async () => {
  const secret = generateBase32Secret();
  const admin = await makeAdminUser({ mfaEnabled: true, mfaSecret: encryptMfaSecret(secret, MFA_KEY) });
  const service = await makeService(admin);
  const tokens = await service.login("admin@example.com", "correct-password", totp(base32Decode(secret)));

  await service.logout(tokens.refreshToken);
  await expect(service.refresh(tokens.refreshToken)).rejects.toThrow(InvalidTokenError);
});

test("refresh rejects an access token presented in place of a refresh token", async () => {
  const secret = generateBase32Secret();
  const admin = await makeAdminUser({ mfaEnabled: true, mfaSecret: encryptMfaSecret(secret, MFA_KEY) });
  const service = await makeService(admin);
  const tokens = await service.login("admin@example.com", "correct-password", totp(base32Decode(secret)));
  await expect(service.refresh(tokens.accessToken)).rejects.toThrow(InvalidTokenError);
});

/* ---------- register / bootstrap ---------- */

test("register(bootstrap=true) creates the first admin, who can then enroll MFA and log in", async () => {
  const service = await makeService();
  await service.register("admin@example.com", "a-real-password", "a-1", true);
  const { secret } = await service.startMfaEnrollment("a-1");
  const code = totp(base32Decode(secret));
  await service.confirmMfaEnrollment("a-1", code);
  const tokens = await service.login("admin@example.com", "a-real-password", code);
  expect(service.verifyAccessToken(tokens.accessToken).adminUserId).toBe("a-1");
});

test("register(bootstrap=true) refuses once any real admin already exists — the shared key only ever creates the first one", async () => {
  const existing = await makeAdminUser();
  const service = await makeService(existing);
  await expect(service.register("second@example.com", "a-real-password", "a-2", true)).rejects.toThrow(AdminBootstrapAlreadyCompleteError);
});

test("register(bootstrap=false) succeeds even when an admin already exists — an already-authenticated admin inviting another", async () => {
  const existing = await makeAdminUser();
  const service = await makeService(existing);
  await expect(service.register("second@example.com", "a-real-password", "a-2", false)).resolves.toMatchObject({ email: "second@example.com" });
});

test("register rejects a duplicate email", async () => {
  const admin = await makeAdminUser();
  const service = await makeService(admin);
  await expect(service.register("admin@example.com", "another-password", "a-dup", false)).rejects.toThrow(AdminEmailAlreadyRegisteredError);
});

test("register rejects a password shorter than the minimum length", async () => {
  const service = await makeService();
  await expect(service.register("new@example.com", "short", "a-1", false)).rejects.toThrow(AdminWeakPasswordError);
});

test("register never returns passwordHash or mfaSecret — only the safe public fields", async () => {
  const service = await makeService();
  const created = await service.register("new@example.com", "a-real-password", "a-1", false);
  expect(created).not.toHaveProperty("passwordHash");
  expect(created).not.toHaveProperty("mfaSecret");
  expect(created).toEqual({ id: "a-1", email: "new@example.com", mfaEnabled: false, isActive: true, createdAt: expect.any(Date) });
});

/* ---------- listAdmins / setActive ---------- */

test("listAdmins returns every real admin, oldest first", async () => {
  const a1 = await makeAdminUser({ id: "a-1", email: "one@example.com", createdAt: new Date("2026-01-01") });
  const a2 = await makeAdminUser({ id: "a-2", email: "two@example.com", createdAt: new Date("2026-02-01") });
  const service = await makeService(a1, a2);
  const admins = await service.listAdmins();
  expect(admins.map((a) => a.id)).toEqual(["a-1", "a-2"]);
});

test("setActive(false) deactivates a second admin when another active admin remains", async () => {
  const a1 = await makeAdminUser({ id: "a-1", email: "one@example.com" });
  const a2 = await makeAdminUser({ id: "a-2", email: "two@example.com" });
  const service = await makeService(a1, a2);
  const updated = await service.setActive("a-2", false);
  expect(updated.isActive).toBe(false);
});

test("setActive(false) throws CannotRemoveLastAdminError when it would leave zero active admins", async () => {
  const only = await makeAdminUser();
  const service = await makeService(only);
  await expect(service.setActive("a-1", false)).rejects.toThrow(CannotRemoveLastAdminError);
});

test("setActive throws AdminUserNotFoundError for an unknown id", async () => {
  const service = await makeService();
  await expect(service.setActive("no-such-id", false)).rejects.toThrow(AdminUserNotFoundError);
});

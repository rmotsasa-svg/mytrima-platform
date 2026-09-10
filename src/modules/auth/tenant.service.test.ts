import { randomUUID } from "node:crypto";
import {
  TenantService,
  InvalidTenantNameError,
  TenantSignupNotEnabledError,
  InvalidSignupCodeError,
  InvalidNotificationPhoneError,
} from "./tenant.service";
import { InMemoryTenantStore } from "./in-memory-tenant.store";
import { AuthService } from "./auth.service";
import { InMemoryAuthUserStore } from "./in-memory-auth-user.store";
import { InMemoryRevokedRefreshTokenStore } from "./in-memory-revoked-token.store";
import { totp, base32Decode } from "./totp";
import { generateMfaEncryptionKey } from "./mfa-secret-crypto";

function makeTenantService(): TenantService {
  const authService = new AuthService(new InMemoryAuthUserStore(), "test-secret", new InMemoryRevokedRefreshTokenStore(), generateMfaEncryptionKey());
  return new TenantService(new InMemoryTenantStore(), authService);
}

test("registerTenant creates a real tenant and its first owner account, which can then log in after enrolling MFA", async () => {
  const authService = new AuthService(new InMemoryAuthUserStore(), "test-secret", new InMemoryRevokedRefreshTokenStore(), generateMfaEncryptionKey());
  const tenantService = new TenantService(new InMemoryTenantStore(), authService);

  const email = `owner-${randomUUID()}@example.com`;
  const result = await tenantService.registerTenant("Brand New Business", email, "a-real-password");
  expect(result.owner.role).toBe("owner");
  expect(result.owner.tenantId).toBe(result.tenantId);

  // Real bug found running this against actual AuthService logic: a plain
  // login() right after registerTenant() throws MfaEnrollmentRequiredError —
  // correctly, per AuthService's own existing rule that owner/administrative
  // accounts must enroll MFA before signing in. Tenant onboarding doesn't
  // bypass that rule; it produces an owner who still has to complete
  // enrollment, same as any other owner account.
  const enrollment = await authService.startMfaEnrollment(result.tenantId, result.owner.id);
  const code = totp(base32Decode(enrollment.secret));
  await authService.confirmMfaEnrollment(result.tenantId, result.owner.id, code);

  const tokens = await authService.login(result.tenantId, email, "a-real-password", totp(base32Decode(enrollment.secret)));
  expect(authService.verifyAccessToken(tokens.accessToken).role).toBe("owner");
});

test("registerTenant rejects an empty tenantName", async () => {
  const tenantService = makeTenantService();
  await expect(tenantService.registerTenant("  ", "owner@example.com", "a-real-password")).rejects.toThrow(InvalidTenantNameError);
});

test("registerTenant still enforces AuthService's own password strength rule", async () => {
  const tenantService = makeTenantService();
  await expect(tenantService.registerTenant("Biz", "owner@example.com", "short")).rejects.toThrow();
});

describe("TenantService.setNotificationPhone", () => {
  test("saves a valid E.164 phone number", async () => {
    const tenantService = makeTenantService();
    const { tenantId } = await tenantService.registerTenant("Biz", "owner@example.com", "a-real-password");
    await expect(tenantService.setNotificationPhone(tenantId, "+26612345678")).resolves.toBeUndefined();
  });

  test.each(["", "not-a-phone", "12345", "+0123456"])("rejects an invalid phone number %p", async (bad) => {
    const tenantService = makeTenantService();
    const { tenantId } = await tenantService.registerTenant("Biz", "owner@example.com", "a-real-password");
    await expect(tenantService.setNotificationPhone(tenantId, bad)).rejects.toThrow(InvalidNotificationPhoneError);
  });
});

describe("TenantService.verifySignupCode", () => {
  const originalEnv = process.env.TENANT_SIGNUP_CODE;
  afterEach(() => {
    process.env.TENANT_SIGNUP_CODE = originalEnv;
  });

  test("throws TenantSignupNotEnabledError when TENANT_SIGNUP_CODE is unset — fails closed, not open", () => {
    delete process.env.TENANT_SIGNUP_CODE;
    expect(() => TenantService.verifySignupCode("anything")).toThrow(TenantSignupNotEnabledError);
  });

  test("throws InvalidSignupCodeError when the provided code doesn't match", () => {
    process.env.TENANT_SIGNUP_CODE = "the-real-code";
    expect(() => TenantService.verifySignupCode("wrong-code")).toThrow(InvalidSignupCodeError);
  });

  test("passes silently when the provided code matches", () => {
    process.env.TENANT_SIGNUP_CODE = "the-real-code";
    expect(() => TenantService.verifySignupCode("the-real-code")).not.toThrow();
  });
});

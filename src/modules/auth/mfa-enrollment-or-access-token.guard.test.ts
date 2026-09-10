import { ExecutionContext } from "@nestjs/common";
import { MfaEnrollmentOrAccessTokenGuard } from "./mfa-enrollment-or-access-token.guard";
import { AuthenticatedRequest } from "./access-token.guard";
import { AuthService, MfaEnrollmentRequiredError } from "./auth.service";
import { InvalidTokenError } from "./jwt";
import { InMemoryAuthUserStore } from "./in-memory-auth-user.store";
import { InMemoryRevokedRefreshTokenStore } from "./in-memory-revoked-token.store";

/** Same fake-ExecutionContext pattern as access-token.guard.test.ts. */
function makeContext(request: Partial<AuthenticatedRequest>): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => request as AuthenticatedRequest,
      getResponse: () => ({}),
      getNext: () => undefined,
    }),
  } as unknown as ExecutionContext;
}

function makeAuthService(): AuthService {
  return new AuthService(new InMemoryAuthUserStore(), "test-secret", new InMemoryRevokedRefreshTokenStore(), "test-mfa-key");
}

/**
 * Regression coverage for the real bug this guard exists to fix (see
 * auth.service.ts's own "REAL BUG found 2026-09-10" comment): a freshly
 * self-registered owner has no real access token yet, but still needs to
 * reach POST /auth/mfa/enroll/start somehow.
 */
test("accepts the enrollmentToken login() hands back for an owner who hasn't enrolled MFA yet", async () => {
  const authService = makeAuthService();
  await authService.register("tenant-A", "fresh-owner@example.com", "password123", "owner", "owner-1");

  let enrollmentToken: string | undefined;
  try {
    await authService.login("tenant-A", "fresh-owner@example.com", "password123");
    throw new Error("expected login() to throw MfaEnrollmentRequiredError");
  } catch (err) {
    if (!(err instanceof MfaEnrollmentRequiredError)) throw err;
    enrollmentToken = err.enrollmentToken;
  }
  expect(enrollmentToken).toBeTruthy();

  const guard = new MfaEnrollmentOrAccessTokenGuard(authService);
  const request: Partial<AuthenticatedRequest> = { headers: { authorization: `Bearer ${enrollmentToken}` } };
  const result = guard.canActivate(makeContext(request));

  expect(result).toBe(true);
  expect(request.user).toEqual({ userId: "owner-1", tenantId: "tenant-A", role: "owner" });
});

test("also accepts a real access token — a staff member (MFA optional for them) can still self-enroll", async () => {
  const authService = makeAuthService();
  await authService.register("tenant-A", "staff@example.com", "password123", "staff", "staff-1");
  const tokens = await authService.login("tenant-A", "staff@example.com", "password123");

  const guard = new MfaEnrollmentOrAccessTokenGuard(authService);
  const request: Partial<AuthenticatedRequest> = { headers: { authorization: `Bearer ${tokens.accessToken}` } };
  expect(guard.canActivate(makeContext(request))).toBe(true);
  expect(request.user).toEqual({ userId: "staff-1", tenantId: "tenant-A", role: "staff" });
});

test("rejects a refresh token", async () => {
  const authService = makeAuthService();
  await authService.register("tenant-A", "staff2@example.com", "password123", "staff", "staff-2");
  const tokens = await authService.login("tenant-A", "staff2@example.com", "password123");

  const guard = new MfaEnrollmentOrAccessTokenGuard(authService);
  const request: Partial<AuthenticatedRequest> = { headers: { authorization: `Bearer ${tokens.refreshToken}` } };
  expect(() => guard.canActivate(makeContext(request))).toThrow(InvalidTokenError);
});

test("rejects a missing Authorization header", () => {
  const guard = new MfaEnrollmentOrAccessTokenGuard(makeAuthService());
  expect(() => guard.canActivate(makeContext({ headers: {} }))).toThrow(InvalidTokenError);
});

test("an enrollment token is rejected by the plain AccessTokenGuard's own verifyAccessToken — it grants no access beyond enrollment", async () => {
  const authService = makeAuthService();
  await authService.register("tenant-A", "fresh-owner-2@example.com", "password123", "owner", "owner-2");

  let enrollmentToken: string | undefined;
  try {
    await authService.login("tenant-A", "fresh-owner-2@example.com", "password123");
  } catch (err) {
    if (err instanceof MfaEnrollmentRequiredError) enrollmentToken = err.enrollmentToken;
  }

  expect(() => authService.verifyAccessToken(enrollmentToken as string)).toThrow(InvalidTokenError);
});

import { ExecutionContext } from "@nestjs/common";
import { AccessTokenGuard, AuthenticatedRequest } from "./access-token.guard";
import { AuthService } from "./auth.service";
import { InvalidTokenError } from "./jwt";
import { InMemoryAuthUserStore } from "./in-memory-auth-user.store";
import { InMemoryRevokedRefreshTokenStore } from "./in-memory-revoked-token.store";

/** Minimal fake ExecutionContext — mirrors the fake-host pattern already
 * used in http-exception.filter.test.ts, scoped to what canActivate needs. */
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

test("rejects a request with no Authorization header at all", () => {
  const guard = new AccessTokenGuard(makeAuthService());
  expect(() => guard.canActivate(makeContext({ headers: {} }))).toThrow(InvalidTokenError);
});

test("rejects an Authorization header that isn't a Bearer token", () => {
  const guard = new AccessTokenGuard(makeAuthService());
  expect(() => guard.canActivate(makeContext({ headers: { authorization: "Basic dXNlcjpwYXNz" } }))).toThrow(InvalidTokenError);
});

test("rejects a well-formed but garbage bearer token", () => {
  const guard = new AccessTokenGuard(makeAuthService());
  expect(() => guard.canActivate(makeContext({ headers: { authorization: "Bearer not.a.realtoken" } }))).toThrow(InvalidTokenError);
});

test("accepts a genuinely issued access token and attaches the verified identity to request.user", async () => {
  const authService = makeAuthService();
  await authService.register("tenant-A", "guard-test@example.com", "password123", "staff", "user-1");
  const tokens = await authService.login("tenant-A", "guard-test@example.com", "password123");

  const guard = new AccessTokenGuard(authService);
  const request: Partial<AuthenticatedRequest> = { headers: { authorization: `Bearer ${tokens.accessToken}` } };
  const result = guard.canActivate(makeContext(request));

  expect(result).toBe(true);
  expect(request.user).toEqual({ userId: "user-1", tenantId: "tenant-A", role: "staff" });
});

/**
 * Regression test for the actual gap this guard exists to close: a refresh
 * token must not work here even though it's a validly-signed JWT from the
 * same issuer — AuthService.verifyAccessToken() already rejects the wrong
 * token type, and this guard must not swallow or bypass that check.
 */
test("rejects a refresh token presented as if it were an access token", async () => {
  const authService = makeAuthService();
  await authService.register("tenant-A", "guard-test-2@example.com", "password123", "staff", "user-2");
  const tokens = await authService.login("tenant-A", "guard-test-2@example.com", "password123");

  const guard = new AccessTokenGuard(authService);
  const request: Partial<AuthenticatedRequest> = { headers: { authorization: `Bearer ${tokens.refreshToken}` } };
  expect(() => guard.canActivate(makeContext(request))).toThrow(InvalidTokenError);
});

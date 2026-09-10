import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import { AuthService } from "./auth.service";
import { InvalidTokenError } from "./jwt";
import { AuthenticatedRequest } from "./access-token.guard";

/**
 * Guards `POST /auth/mfa/enroll/start` and `/confirm` specifically — see
 * auth.service.ts's own "REAL BUG found 2026-09-10" comment for exactly why
 * `AccessTokenGuard` alone locked every freshly self-registered owner out
 * of their own account (no access token exists until MFA is enrolled, but
 * enrolling needed one). Accepts either a real access token (an
 * already-logged-in staff member optionally self-enrolling — MFA isn't
 * required for their role) or the short-lived, single-purpose enrollment
 * token `login()` hands back inside `MfaEnrollmentRequiredError` for a
 * fresh owner. Nowhere else in the app accepts the enrollment token type —
 * `AccessTokenGuard`'s own `verifyAccessToken()` still rejects it.
 */
const BEARER_PREFIX = "Bearer ";

@Injectable()
export class MfaEnrollmentOrAccessTokenGuard implements CanActivate {
  constructor(private readonly authService: AuthService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const header = request.headers.authorization;
    if (!header || !header.startsWith(BEARER_PREFIX)) {
      throw new InvalidTokenError("Missing or malformed Authorization header — expected 'Bearer <token>'");
    }
    const token = header.slice(BEARER_PREFIX.length);
    request.user = this.authService.verifyAccessOrMfaEnrollmentToken(token);
    return true;
  }
}

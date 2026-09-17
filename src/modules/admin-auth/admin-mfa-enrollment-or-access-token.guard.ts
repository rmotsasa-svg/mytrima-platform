import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import { AdminAuthService } from "./admin-auth.service";
import { InvalidTokenError } from "../auth/jwt";
import { AuthenticatedAdminRequest } from "./admin-access-token.guard";

/** Structural copy of mfa-enrollment-or-access-token.guard.ts — a freshly
 * registered admin has no real access token until MFA is enrolled, so
 * POST /admin-auth/mfa/start and /confirm accept either a real admin
 * access token or the short-lived admin_mfa_enrollment token login()
 * hands back inside AdminMfaEnrollmentRequiredError. */
const BEARER_PREFIX = "Bearer ";

@Injectable()
export class AdminMfaEnrollmentOrAccessTokenGuard implements CanActivate {
  constructor(private readonly adminAuthService: AdminAuthService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedAdminRequest>();
    const header = request.headers.authorization;
    if (!header || !header.startsWith(BEARER_PREFIX)) {
      throw new InvalidTokenError("Missing or malformed Authorization header — expected 'Bearer <token>'");
    }
    const token = header.slice(BEARER_PREFIX.length);
    request.adminUser = this.adminAuthService.verifyAccessOrMfaEnrollmentToken(token);
    return true;
  }
}

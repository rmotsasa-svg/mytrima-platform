import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import type { Request } from "express";
import { AuthService, VerifiedAccessToken } from "./auth.service";
import { InvalidTokenError } from "./jwt";

/**
 * Closes the KNOWN GAP flagged on the MFA enrollment endpoints (and on
 * AuthService.startMfaEnrollment()/confirmMfaEnrollment()): nothing
 * previously stopped caller A from enrolling MFA against caller B's account,
 * because tenantId/userId were trusted as plain request-body fields.
 *
 * Validates the caller's own access token (Authorization: Bearer <token>)
 * and attaches the verified identity to request.user, so a guarded
 * controller method can derive tenantId/userId/role from *that* — never
 * from body input a caller could set to anyone's id. Delegates entirely to
 * AuthService.verifyAccessToken(), which already rejects a missing/
 * malformed/expired/wrong-type token with InvalidTokenError/TokenExpiredError
 * — both already mapped to 401 by DomainErrorFilter, so this guard adds no
 * new error-mapping surface to maintain.
 *
 * KNOWN GAP this does NOT close: there is still no route-level RBAC check
 * (rbac.ts's authorize()) here — this guard only proves *who* the caller is,
 * not that their role permits the specific action. Fine for MFA enrollment
 * (any authenticated user may enroll their own MFA, by design), but a guard
 * reused for a permission-gated route would need to call authorize() too.
 */
export interface AuthenticatedRequest extends Request {
  user?: VerifiedAccessToken;
}

const BEARER_PREFIX = "Bearer ";

@Injectable()
export class AccessTokenGuard implements CanActivate {
  constructor(private readonly authService: AuthService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const header = request.headers.authorization;
    if (!header || !header.startsWith(BEARER_PREFIX)) {
      throw new InvalidTokenError("Missing or malformed Authorization header — expected 'Bearer <accessToken>'");
    }
    const token = header.slice(BEARER_PREFIX.length);
    // Throws InvalidTokenError/TokenExpiredError on anything wrong — let it
    // propagate to DomainErrorFilter rather than catching it here.
    request.user = this.authService.verifyAccessToken(token);
    return true;
  }
}

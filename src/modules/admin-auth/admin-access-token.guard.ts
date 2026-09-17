import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import type { Request } from "express";
import { AdminAuthService, VerifiedAdminAccessToken } from "./admin-auth.service";
import { InvalidTokenError } from "../auth/jwt";

/** Structural copy of access-token.guard.ts, verifying an admin_access
 * token instead of a tenant one and attaching request.adminUser (a
 * deliberately different request property than the tenant guard's own
 * request.user — the two identity shapes are structurally distinct and
 * must never be confused by a controller that forgets which guard it's
 * behind). */
export interface AuthenticatedAdminRequest extends Request {
  adminUser?: VerifiedAdminAccessToken;
}

const BEARER_PREFIX = "Bearer ";

@Injectable()
export class AdminAccessTokenGuard implements CanActivate {
  constructor(private readonly adminAuthService: AdminAuthService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedAdminRequest>();
    const header = request.headers.authorization;
    if (!header || !header.startsWith(BEARER_PREFIX)) {
      throw new InvalidTokenError("Missing or malformed Authorization header — expected 'Bearer <accessToken>'");
    }
    const token = header.slice(BEARER_PREFIX.length);
    request.adminUser = this.adminAuthService.verifyAccessToken(token);
    return true;
  }
}

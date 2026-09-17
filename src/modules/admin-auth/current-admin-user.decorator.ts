import { createParamDecorator, ExecutionContext } from "@nestjs/common";
import { AuthenticatedAdminRequest } from "./admin-access-token.guard";
import { VerifiedAdminAccessToken } from "./admin-auth.service";

/** Structural copy of current-user.decorator.ts, reading request.adminUser
 * instead of request.user. Throws (rather than returning undefined) if
 * the guard never ran — same "fail loudly in development" reasoning. */
export const CurrentAdminUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): VerifiedAdminAccessToken => {
  const request = ctx.switchToHttp().getRequest<AuthenticatedAdminRequest>();
  if (!request.adminUser) {
    throw new Error("@CurrentAdminUser() used on a route with no AdminAccessTokenGuard — nothing verified request.adminUser");
  }
  return request.adminUser;
});

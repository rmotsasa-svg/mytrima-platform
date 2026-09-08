import { createParamDecorator, ExecutionContext } from "@nestjs/common";
import { AuthenticatedRequest } from "./access-token.guard";
import { VerifiedAccessToken } from "./auth.service";

/**
 * Reads the identity AccessTokenGuard already verified and attached to
 * request.user. Throwing here (rather than returning undefined) if the guard
 * never ran is deliberate: a controller method that uses @CurrentUser() but
 * forgets @UseGuards(AccessTokenGuard) should fail loudly in development,
 * not silently receive `undefined` and produce a confusing downstream error.
 */
export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): VerifiedAccessToken => {
  const request = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
  if (!request.user) {
    throw new Error("@CurrentUser() used on a route with no AccessTokenGuard — nothing verified request.user");
  }
  return request.user;
});

import { Body, Controller, Post, UseGuards } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { AuthService, Role, VerifiedAccessToken } from "./auth.service";
import { AccessTokenGuard } from "./access-token.guard";
import { CurrentUser } from "./current-user.decorator";
import { authorize } from "./rbac";

interface RegisterBody {
  email: string;
  password: string;
  role: Role;
}

interface LoginBody {
  tenantId: string;
  email: string;
  password: string;
  totpCode?: string;
}

interface RefreshBody {
  refreshToken: string;
}

interface LogoutBody {
  refreshToken: string;
}

interface MfaEnrollConfirmBody {
  code: string;
}

/**
 * CLOSED: registration used to be wide open — anyone could self-register as
 * any role, including 'owner', for any tenantId they named in the request
 * body, with nothing checking who was calling. `/register` now sits behind
 * AccessTokenGuard (so the caller must already be a real, authenticated
 * account) plus rbac.ts's `authorize()` against the `'user:manage'`
 * permission — only an `owner`-role caller may register a new account, and
 * only into their own tenant (`tenantId` comes from the caller's verified
 * token, not the body — the same fix pattern as the MFA endpoints below).
 * This is `authorize()`'s first real caller anywhere in this codebase —
 * previously it existed and was unit-tested (rbac.test.ts) but nothing
 * actually invoked it.
 *
 * KNOWN GAP this creates, not fixed here: a brand-new tenant's very first
 * account has no existing owner to authenticate as, so nothing can call
 * this endpoint to bootstrap one. That's a tenant-provisioning problem —
 * out of scope for "who may invite a teammate" — and is exactly how
 * DEMO_TENANT_ID's own seed user is created today: directly via
 * `AuthUserStore.save()` in auth.module.ts, not through this endpoint. A
 * real tenant-onboarding flow (Master Plan doesn't specify one) would need
 * its own separate, unauthenticated "create tenant + its first owner"
 * endpoint — deliberately not invented here to avoid guessing that design.
 *
 * CLOSED separately: the MFA enrollment endpoints used to take
 * tenantId/userId as plain request-body fields — caller A could enroll MFA
 * against caller B's account just by naming their id. Both endpoints now
 * sit behind AccessTokenGuard, which verifies the caller's own access token
 * and derives tenantId/userId from *that* (see access-token.guard.ts); the
 * request body carries only what a caller couldn't otherwise prove, like
 * the TOTP code.
 */
@Controller("auth")
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @UseGuards(AccessTokenGuard)
  @Post("register")
  register(@CurrentUser() actor: VerifiedAccessToken, @Body() body: RegisterBody) {
    authorize(actor, actor.tenantId, "user:manage");
    return this.authService.register(actor.tenantId, body.email, body.password, body.role, randomUUID());
  }

  @Post("login")
  login(@Body() body: LoginBody) {
    return this.authService.login(body.tenantId, body.email, body.password, body.totpCode);
  }

  @Post("refresh")
  refresh(@Body() body: RefreshBody) {
    return this.authService.refresh(body.refreshToken);
  }

  @Post("logout")
  async logout(@Body() body: LogoutBody) {
    await this.authService.logout(body.refreshToken);
    return { loggedOut: true };
  }

  @UseGuards(AccessTokenGuard)
  @Post("mfa/enroll/start")
  startMfaEnrollment(@CurrentUser() user: VerifiedAccessToken) {
    return this.authService.startMfaEnrollment(user.tenantId, user.userId);
  }

  @UseGuards(AccessTokenGuard)
  @Post("mfa/enroll/confirm")
  async confirmMfaEnrollment(@CurrentUser() user: VerifiedAccessToken, @Body() body: MfaEnrollConfirmBody) {
    await this.authService.confirmMfaEnrollment(user.tenantId, user.userId, body.code);
    return { mfaEnabled: true };
  }
}

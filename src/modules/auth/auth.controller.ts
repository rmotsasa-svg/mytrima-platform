import { Body, Controller, Post, UseGuards } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { AuthService, Role, VerifiedAccessToken } from "./auth.service";
import { TenantService } from "./tenant.service";
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

interface RegisterTenantBody {
  signupCode: string;
  tenantName: string;
  ownerEmail: string;
  ownerPassword: string;
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
 * CLOSED separately (Master Plan Addendum v1.3, Section H): a brand-new
 * tenant's very first account had no existing owner to authenticate as, so
 * nothing could call this endpoint to bootstrap one — that's a tenant-
 * provisioning problem, out of scope for "who may invite a teammate."
 * `POST /auth/tenants` below is the deliberately separate, unauthenticated
 * "create tenant + its first owner" endpoint that gap needed — gated by a
 * shared signup code (TenantService.verifySignupCode()) rather than left
 * wide open, since this is the one legitimate case where an unauthenticated
 * write is correct (there is, by definition, no existing account to
 * authenticate as for tenant #1).
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
  constructor(
    private readonly authService: AuthService,
    private readonly tenantService: TenantService
  ) {}

  /** The one legitimate unauthenticated write in this whole module — see
   * this file's own top comment for why. Fails closed: TenantService.
   * verifySignupCode() throws TenantSignupNotEnabledError when
   * TENANT_SIGNUP_CODE is unset, rather than defaulting to open. */
  @Post("tenants")
  registerTenant(@Body() body: RegisterTenantBody) {
    TenantService.verifySignupCode(body.signupCode);
    return this.tenantService.registerTenant(body.tenantName, body.ownerEmail, body.ownerPassword);
  }

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

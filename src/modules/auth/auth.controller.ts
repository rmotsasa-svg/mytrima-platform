import { Body, Controller, Get, Patch, Post, UseGuards } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { AuthService, MfaEnrollmentRequiredError, Role, VerifiedAccessToken } from "./auth.service";
import { BusinessProfileInput, TenantService } from "./tenant.service";
import { AccessTokenGuard } from "./access-token.guard";
import { MfaEnrollmentOrAccessTokenGuard } from "./mfa-enrollment-or-access-token.guard";
import { CurrentUser } from "./current-user.decorator";
import { authorize } from "./rbac";
import { RateLimit } from "../../common/rate-limit.decorator";
import { RateLimitGuard } from "../../common/rate-limit.guard";

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

interface NotificationPhoneBody {
  notificationPhoneE164: string;
}

/** Reuses BusinessProfileInput's own shape (tenant.service.ts) directly —
 * every field optional, same reasoning as that type's own comment. */
type BusinessProfileBody = BusinessProfileInput;

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

  /**
   * A fresh owner's first-ever login is EXPECTED to reach here without
   * completing (see auth.service.ts's own "REAL BUG found 2026-09-10"
   * comment) — that isn't a failure to hide behind a generic 401. Catches
   * MfaEnrollmentRequiredError specifically and returns its enrollmentToken
   * so a real client (or this dashboard) can walk the owner through
   * enroll -> confirm immediately, using the exact mechanism
   * MfaEnrollmentOrAccessTokenGuard accepts. Any other login failure
   * (wrong password, MFA code required/invalid, etc.) still propagates to
   * DomainErrorFilter unchanged.
   *
   * Rate-limited (real gap found by deep review, fixed 2026-09-10, before
   * any real tenant transacts): 10 attempts per 5 minutes per client IP —
   * a disclosed default, not a researched optimum, same as every other
   * undecided-but-necessary number in this project.
   */
  @UseGuards(RateLimitGuard)
  @RateLimit({ max: 10, windowMs: 5 * 60 * 1000 })
  @Post("login")
  async login(@Body() body: LoginBody) {
    try {
      return await this.authService.login(body.tenantId, body.email, body.password, body.totpCode);
    } catch (err) {
      if (err instanceof MfaEnrollmentRequiredError) {
        return { mfaEnrollmentRequired: true, enrollmentToken: err.enrollmentToken };
      }
      throw err;
    }
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

  @UseGuards(MfaEnrollmentOrAccessTokenGuard)
  @Post("mfa/enroll/start")
  startMfaEnrollment(@CurrentUser() user: VerifiedAccessToken) {
    return this.authService.startMfaEnrollment(user.tenantId, user.userId);
  }

  @UseGuards(MfaEnrollmentOrAccessTokenGuard)
  @Post("mfa/enroll/confirm")
  async confirmMfaEnrollment(@CurrentUser() user: VerifiedAccessToken, @Body() body: MfaEnrollConfirmBody) {
    await this.authService.confirmMfaEnrollment(user.tenantId, user.userId, body.code);
    return { mfaEnabled: true };
  }

  /** Where a real WhatsApp notification for this tenant actually gets sent
   * — see notification-worker.service.ts. `tenant:manage_settings` (owner
   * only) was already defined in rbac.ts but had no real caller anywhere
   * until this — same "permission existed, unit-tested, never actually
   * invoked" gap authorize()'s own top comment already describes for
   * user:manage before /register used it. tenantId comes from the actor's
   * verified token, not the body — same fix pattern as every other
   * endpoint here. */
  @UseGuards(AccessTokenGuard)
  @Patch("tenants/notification-phone")
  async setNotificationPhone(@CurrentUser() actor: VerifiedAccessToken, @Body() body: NotificationPhoneBody) {
    authorize(actor, actor.tenantId, "tenant:manage_settings");
    await this.tenantService.setNotificationPhone(actor.tenantId, body.notificationPhoneE164);
    return { success: true };
  }

  /**
   * REAL GAP closed 2026-09-11: nothing anywhere in this API ever returned
   * a tenant's own record — TenantService.getById() existed and was used
   * internally (PaymentsController, OnboardingService) but had no HTTP
   * route, so a real client had no way to read back its own name, or any
   * of the new business-profile fields below, once set. `tenant:manage_settings`
   * would be the wrong permission here — read_only can't manage anything,
   * but there's no reason a read_only staff member shouldn't see their own
   * employer's business profile — so this reuses `reports:view` instead,
   * the one existing permission every role already has (see rbac.ts).
   */
  @UseGuards(AccessTokenGuard)
  @Get("tenants/me")
  async getOwnTenant(@CurrentUser() actor: VerifiedAccessToken) {
    authorize(actor, actor.tenantId, "reports:view");
    return this.tenantService.getById(actor.tenantId);
  }

  /** The business-setup page's own write endpoint — description, industry,
   * location, contact details, and stated growth goal (migration 0024,
   * BusinessProfileInput). Every field optional: a tenant fills this in
   * incrementally, and each PATCH only touches the fields it actually
   * names (see PgTenantStore.updateBusinessProfile()'s own comment). Same
   * `tenant:manage_settings` permission the other tenant-level settings
   * endpoints in this file already use. */
  @UseGuards(AccessTokenGuard)
  @Patch("tenants/business-profile")
  async setBusinessProfile(@CurrentUser() actor: VerifiedAccessToken, @Body() body: BusinessProfileBody) {
    authorize(actor, actor.tenantId, "tenant:manage_settings");
    await this.tenantService.setBusinessProfile(actor.tenantId, body);
    return { success: true };
  }
}

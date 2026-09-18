import { Body, Controller, Get, Post, UseGuards } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { IsEmail, IsNotEmpty, IsOptional, IsString, MinLength } from "class-validator";
import { AdminAuthService, AdminMfaEnrollmentRequiredError, VerifiedAdminAccessToken } from "./admin-auth.service";
import { AdminAccessTokenGuard } from "./admin-access-token.guard";
import { AdminMfaEnrollmentOrAccessTokenGuard } from "./admin-mfa-enrollment-or-access-token.guard";
import { CurrentAdminUser } from "./current-admin-user.decorator";
import { AdminApiKeyGuard } from "../admin/admin-api-key.guard";
import { RateLimit } from "../../common/rate-limit.decorator";
import { RateLimitGuard } from "../../common/rate-limit.guard";
import { AuditLogService } from "../audit-log/audit-log.service";

class RegisterAdminBody {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8)
  password!: string;
}

class LoginBody {
  @IsEmail()
  email!: string;

  @IsString()
  @IsNotEmpty()
  password!: string;

  /** REAL BUG found live-testing this endpoint: @IsString() alone still
   * validates (and rejects) an omitted field — @IsOptional() is what
   * actually makes class-validator skip a genuinely-undefined value, the
   * same gap this codebase has already found and fixed elsewhere for a
   * DTO's own optional field. */
  @IsOptional()
  @IsString()
  totpCode?: string;
}

class RefreshBody {
  @IsString()
  @IsNotEmpty()
  refreshToken!: string;
}

class LogoutBody {
  @IsString()
  @IsNotEmpty()
  refreshToken!: string;
}

class MfaEnrollConfirmBody {
  @IsString()
  @IsNotEmpty()
  code!: string;
}

/**
 * Real multi-admin authentication — see admin-auth.service.ts's own top
 * comment for the full design. `POST /admin-auth/register` is the ONE
 * remaining job of the shared ADMIN_API_KEY secret (AdminApiKeyGuard):
 * bootstrapping the very first admin account when none exist yet.
 * `POST /admin-auth/admins` is how every admin after that gets created —
 * gated by AdminAccessTokenGuard, i.e. you must already be a logged-in
 * admin. `AdminController` (admin/admin.controller.ts) — the tenant-
 * management/pilot-summary routes — moves from AdminApiKeyGuard to
 * AdminAccessTokenGuard in the same change that adds this controller.
 */
@Controller("admin-auth")
export class AdminAuthController {
  constructor(
    private readonly adminAuthService: AdminAuthService,
    private readonly auditLogService: AuditLogService
  ) {}

  /** Rate-limited the same as tenant registration — account creation, not
   * a retry, is the thing being throttled. */
  @UseGuards(AdminApiKeyGuard, RateLimitGuard)
  @RateLimit({ max: 5, windowMs: 60 * 60 * 1000 })
  @Post("register")
  registerBootstrap(@Body() body: RegisterAdminBody) {
    return this.adminAuthService.register(body.email, body.password, randomUUID(), true);
  }

  @UseGuards(AdminAccessTokenGuard)
  @Post("admins")
  async createAdmin(@Body() body: RegisterAdminBody, @CurrentAdminUser() admin: VerifiedAdminAccessToken) {
    const created = await this.adminAuthService.register(body.email, body.password, randomUUID(), false);
    await this.auditLogService.recordAdminAction("admin.create", "admin_user", created.id, admin.adminUserId);
    return created;
  }

  @UseGuards(AdminAccessTokenGuard)
  @Get("admins")
  listAdmins() {
    return this.adminAuthService.listAdmins();
  }

  /** Self-service "who am I" — mirrors GET /staff/me, so the admin app's
   * own post-login screen can show a real email, not just an id. */
  @UseGuards(AdminAccessTokenGuard)
  @Get("me")
  me(@CurrentAdminUser() admin: VerifiedAdminAccessToken) {
    return this.adminAuthService.getProfile(admin.adminUserId);
  }

  /** Same "a fresh admin's first login is EXPECTED to reach here without
   * completing" reasoning as AuthController.login()'s own comment — MFA
   * enrollment is unconditional for every admin, so this always happens
   * on a brand-new account's very first login. */
  @UseGuards(RateLimitGuard)
  @RateLimit({ max: 10, windowMs: 5 * 60 * 1000 })
  @Post("login")
  async login(@Body() body: LoginBody) {
    try {
      return await this.adminAuthService.login(body.email, body.password, body.totpCode);
    } catch (err) {
      if (err instanceof AdminMfaEnrollmentRequiredError) {
        return { mfaEnrollmentRequired: true, enrollmentToken: err.enrollmentToken };
      }
      throw err;
    }
  }

  @Post("refresh")
  refresh(@Body() body: RefreshBody) {
    return this.adminAuthService.refresh(body.refreshToken);
  }

  @Post("logout")
  async logout(@Body() body: LogoutBody) {
    await this.adminAuthService.logout(body.refreshToken);
    return { loggedOut: true };
  }

  @UseGuards(AdminMfaEnrollmentOrAccessTokenGuard)
  @Post("mfa/start")
  startMfaEnrollment(@CurrentAdminUser() admin: VerifiedAdminAccessToken) {
    return this.adminAuthService.startMfaEnrollment(admin.adminUserId);
  }

  @UseGuards(AdminMfaEnrollmentOrAccessTokenGuard)
  @Post("mfa/confirm")
  async confirmMfaEnrollment(@CurrentAdminUser() admin: VerifiedAdminAccessToken, @Body() body: MfaEnrollConfirmBody) {
    await this.adminAuthService.confirmMfaEnrollment(admin.adminUserId, body.code);
    return { mfaEnabled: true };
  }
}

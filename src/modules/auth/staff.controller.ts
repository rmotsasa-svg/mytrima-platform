import { Body, Controller, Get, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { AuthService, VerifiedAccessToken, Role } from "./auth.service";
import { StaffActivityLogService } from "./staff-activity.service";
import { AccessTokenGuard } from "./access-token.guard";
import { CurrentUser } from "./current-user.decorator";
import { authorize } from "./rbac";

interface ChangeRoleBody {
  role: Role;
}

interface SetActiveBody {
  isActive: boolean;
}

interface ChangeOwnPasswordBody {
  currentPassword: string;
  newPassword: string;
}

interface UpdateProfileBody {
  firstName?: string;
  lastName?: string;
}

/**
 * The Staff module — requested directly by the tenant ("do we have a staff
 * module and access control module for staff"). rbac.ts already IS the
 * access-control model (Owner/Staff/Read-only, tenant-scoped); what didn't
 * exist was any way to manage the accounts that model applies to beyond a
 * one-way `POST /auth/register` invite. Lives inside the auth module itself
 * (not a separate module) since it operates on the exact same AuthService/
 * AuthUserStore — no new store, no cross-module guard-redeclaration
 * concern, same reasoning TenantService already lives here for.
 *
 * Two distinct shapes of route, same as every other actor-split module this
 * session (booking, support tickets): self-service (`/staff/me/*`, any
 * authenticated user, acts on their own account only) versus owner-managing-
 * others (`/staff`, `/staff/:userId/*`, gated by `user:manage` — the exact
 * permission `POST /auth/register` already uses for inviting someone in the
 * first place).
 */
@UseGuards(AccessTokenGuard)
@Controller("staff")
export class StaffController {
  constructor(
    private readonly authService: AuthService,
    private readonly staffActivityLogService: StaffActivityLogService
  ) {}

  @Get("me")
  getOwnProfile(@CurrentUser() actor: VerifiedAccessToken) {
    return this.authService.getProfile(actor.tenantId, actor.userId);
  }

  @Post("me/change-password")
  async changeOwnPassword(@CurrentUser() actor: VerifiedAccessToken, @Body() body: ChangeOwnPasswordBody) {
    await this.authService.changeOwnPassword(actor.tenantId, actor.userId, body.currentPassword, body.newPassword);
    return { passwordChanged: true };
  }

  /** "Allow tenant to add Name and lastname" — real gap closed 2026-09-14:
   * a staff member editing their OWN name needs no special permission
   * beyond being authenticated, same reasoning as changeOwnPassword()
   * above. Real PATCH semantics — see AuthService.updateProfile()'s own
   * comment. */
  @Patch("me")
  updateOwnProfile(@CurrentUser() actor: VerifiedAccessToken, @Body() body: UpdateProfileBody) {
    return this.authService.updateProfile(actor.tenantId, actor.userId, body.firstName, body.lastName);
  }

  @Get()
  list(@CurrentUser() actor: VerifiedAccessToken) {
    authorize(actor, actor.tenantId, "user:manage");
    return this.authService.listStaffForTenant(actor.tenantId);
  }

  /** An owner/manager editing a teammate's name — same `user:manage` gate
   * as changeRole()/deactivate()/reactivate() below, since this acts on
   * someone else's account. */
  @Patch(":userId")
  updateProfile(@CurrentUser() actor: VerifiedAccessToken, @Param("userId") userId: string, @Body() body: UpdateProfileBody) {
    authorize(actor, actor.tenantId, "user:manage");
    return this.authService.updateProfile(actor.tenantId, userId, body.firstName, body.lastName);
  }

  @Patch(":userId/role")
  changeRole(@CurrentUser() actor: VerifiedAccessToken, @Param("userId") userId: string, @Body() body: ChangeRoleBody) {
    authorize(actor, actor.tenantId, "user:manage");
    return this.authService.changeRole(actor.tenantId, userId, body.role);
  }

  @Post(":userId/deactivate")
  deactivate(@CurrentUser() actor: VerifiedAccessToken, @Param("userId") userId: string) {
    authorize(actor, actor.tenantId, "user:manage");
    return this.authService.setActive(actor.tenantId, userId, false);
  }

  @Post(":userId/reactivate")
  reactivate(@CurrentUser() actor: VerifiedAccessToken, @Param("userId") userId: string) {
    authorize(actor, actor.tenantId, "user:manage");
    return this.authService.setActive(actor.tenantId, userId, true);
  }

  /**
   * "Add staff activities history" — real gap closed 2026-09-14. Any
   * signed-in staff member can view their OWN activity (`userId ===
   * actor.userId`, no extra permission needed, same reasoning as `/me`
   * above); viewing a TEAMMATE's activity needs `user:manage`, same gate
   * as every other owner/manager-acting-on-someone-else route in this
   * controller. See staff-activity.service.ts's own comment for exactly
   * which real actions this covers.
   */
  @Get(":userId/activity")
  activity(@CurrentUser() actor: VerifiedAccessToken, @Param("userId") userId: string) {
    if (userId !== actor.userId) {
      authorize(actor, actor.tenantId, "user:manage");
    }
    return this.staffActivityLogService.listForTenant(actor.tenantId, userId);
  }
}

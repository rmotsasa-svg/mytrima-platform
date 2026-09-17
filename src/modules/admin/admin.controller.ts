import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { IsString, IsNotEmpty } from "class-validator";
import { AdminAccessTokenGuard } from "../admin-auth/admin-access-token.guard";
import { PilotSummaryService } from "./pilot-summary.service";
import { SupportTicketAdminService } from "./support-ticket-admin.service";
import { AdminTenantService } from "./admin-tenant.service";

/** A real `class`, not a plain `interface` — converted 2026-09-11 as part
 * of closing the real gap the global ValidationPipe (main.ts) now defends
 * against project-wide. This is the exact body whose omitted
 * `resolutionNotes` field caused a real 500 this session before
 * SupportTicketService.resolve()'s own truthiness-check fix — the pipe now
 * rejects the same request with a clean 400 before it even reaches the
 * service, as defense in depth alongside that fix, not instead of it. */
export class ResolveSupportTicketBody {
  @IsString()
  @IsNotEmpty()
  resolutionNotes!: string;
}

/** Migrated from the shared ADMIN_API_KEY secret to real per-admin auth
 * (Phase 1 of the admin-platform plan) — AdminApiKeyGuard's only
 * remaining job is bootstrapping the very first admin account (see
 * admin-auth.controller.ts's own top comment). */
@UseGuards(AdminAccessTokenGuard)
@Controller("admin")
export class AdminController {
  constructor(
    private readonly pilotSummaryService: PilotSummaryService,
    private readonly supportTicketAdminService: SupportTicketAdminService,
    private readonly adminTenantService: AdminTenantService
  ) {}

  @Get("pilot-summary")
  getPilotSummary() {
    return this.pilotSummaryService.getSummary();
  }

  /** Phase 2 of the admin-platform plan — real tenant management. */
  @Get("tenants")
  listTenants() {
    return this.adminTenantService.listTenants();
  }

  @Get("tenants/:tenantId")
  getTenantDetail(@Param("tenantId") tenantId: string) {
    return this.adminTenantService.getTenantDetail(tenantId);
  }

  @Post("tenants/:tenantId/suspend")
  async suspendTenant(@Param("tenantId") tenantId: string) {
    await this.adminTenantService.suspend(tenantId);
    return { success: true };
  }

  @Post("tenants/:tenantId/reactivate")
  async reactivateTenant(@Param("tenantId") tenantId: string) {
    await this.adminTenantService.reactivate(tenantId);
    return { success: true };
  }

  @Get("support-tickets")
  listSupportTickets() {
    return this.supportTicketAdminService.listAcrossTenants();
  }

  @Post("support-tickets/:tenantId/:ticketId/in-progress")
  markInProgress(@Param("tenantId") tenantId: string, @Param("ticketId") ticketId: string) {
    return this.supportTicketAdminService.markInProgress(tenantId, ticketId);
  }

  @Post("support-tickets/:tenantId/:ticketId/resolve")
  resolve(@Param("tenantId") tenantId: string, @Param("ticketId") ticketId: string, @Body() body: ResolveSupportTicketBody) {
    return this.supportTicketAdminService.resolve(tenantId, ticketId, body.resolutionNotes);
  }
}

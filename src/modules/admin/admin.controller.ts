import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { IsString, IsNotEmpty } from "class-validator";
import { AdminApiKeyGuard } from "./admin-api-key.guard";
import { PilotSummaryService } from "./pilot-summary.service";
import { SupportTicketAdminService } from "./support-ticket-admin.service";

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

@UseGuards(AdminApiKeyGuard)
@Controller("admin")
export class AdminController {
  constructor(
    private readonly pilotSummaryService: PilotSummaryService,
    private readonly supportTicketAdminService: SupportTicketAdminService
  ) {}

  @Get("pilot-summary")
  getPilotSummary() {
    return this.pilotSummaryService.getSummary();
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

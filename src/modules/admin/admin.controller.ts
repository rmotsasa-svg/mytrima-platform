import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { AdminApiKeyGuard } from "./admin-api-key.guard";
import { PilotSummaryService } from "./pilot-summary.service";
import { SupportTicketAdminService } from "./support-ticket-admin.service";

interface ResolveSupportTicketBody {
  resolutionNotes: string;
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

import { Body, Controller, Get, NotFoundException, Param, Post, UseGuards } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { SupportTicketService, SupportTicketSeverity } from "./support-ticket.service";
import { AccessTokenGuard } from "../auth/access-token.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import { VerifiedAccessToken } from "../auth/auth.service";

interface CreateSupportTicketBody {
  subject: string;
  description: string;
  severity?: SupportTicketSeverity;
}

/**
 * Every route here derives `tenantId`/`createdByUserId` from the actor's own
 * verified access token, never from the request body or a URL param — same
 * fix pattern PaymentsController/AuthController's notification-phone
 * endpoint already established: a tenant can only ever file, view, or
 * reopen its OWN tickets, with no way to even ask about another tenant's.
 * The operator side (cross-tenant, list/resolve any ticket) lives in
 * admin/support-ticket-admin.service.ts behind AdminApiKeyGuard instead —
 * see support-ticket.service.ts's own top comment for why these are two
 * separate guards, not one bent to fit both.
 */
@UseGuards(AccessTokenGuard)
@Controller("support-tickets")
export class SupportTicketController {
  constructor(private readonly supportTicketService: SupportTicketService) {}

  @Post()
  create(@CurrentUser() actor: VerifiedAccessToken, @Body() body: CreateSupportTicketBody) {
    return this.supportTicketService.create(actor.tenantId, randomUUID(), actor.userId, body.subject, body.description, body.severity);
  }

  @Get()
  list(@CurrentUser() actor: VerifiedAccessToken) {
    return this.supportTicketService.listForTenant(actor.tenantId);
  }

  @Get(":id")
  async getOne(@CurrentUser() actor: VerifiedAccessToken, @Param("id") id: string) {
    const ticket = await this.supportTicketService.findById(actor.tenantId, id);
    if (!ticket) throw new NotFoundException(`No support ticket found with id "${id}"`);
    return ticket;
  }

  /** "That didn't actually fix it" — see SupportTicketService.reopen()'s
   * own comment. Deliberately the tenant's own action, unlike
   * markInProgress()/resolve() which are the operator's. */
  @Post(":id/reopen")
  reopen(@CurrentUser() actor: VerifiedAccessToken, @Param("id") id: string) {
    return this.supportTicketService.reopen(actor.tenantId, id);
  }
}

import { Body, Controller, Get, NotFoundException, Param, Post, UseGuards } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { IsString, IsNotEmpty, IsOptional, IsIn } from "class-validator";
import { SupportTicketService, SupportTicketSeverity } from "./support-ticket.service";
import { AccessTokenGuard } from "../auth/access-token.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import { VerifiedAccessToken } from "../auth/auth.service";
import { RateLimit } from "../../common/rate-limit.decorator";
import { RateLimitGuard } from "../../common/rate-limit.guard";

/** A real `class`, not a plain `interface` — see BookingController's own
 * comment on why. This is the exact DTO whose validation gap caused the
 * real 500 bug this session (an omitted `resolutionNotes` reaching
 * `.trim()` as genuine `undefined`, on the *resolve* endpoint) — converting
 * *this* controller's own create() body first, not a coincidence. */
export class CreateSupportTicketBody {
  @IsString()
  @IsNotEmpty()
  subject!: string;

  @IsString()
  @IsNotEmpty()
  description!: string;

  @IsOptional()
  @IsIn(["low", "normal", "high", "critical"])
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

  /** Rate-limited 2026-09-11 — authenticated, unlike Booking/Rating/NPS's
   * submit endpoints, but the Platform Readiness Assessment named this one
   * explicitly among the exposed write endpoints, so it gets the same
   * defense: 20 per minute per client IP, not because a stranger could
   * reach it, but because an accidental client bug or a compromised staff
   * account shouldn't be able to flood it either. */
  @UseGuards(RateLimitGuard)
  @RateLimit({ max: 20, windowMs: 60 * 1000 })
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

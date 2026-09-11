import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { GrowthAuditService, Answers, AuditResult } from "./growth-audit.service";
import { SECTIONS, QUESTION_TEXT } from "./questions.data";
import { notificationsForGrowthAudit, NotificationEvent } from "../automation/automation.service";
import { NotificationDeliveryService } from "../automation/notification-delivery.service";
import { AccessTokenGuard } from "../auth/access-token.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import { VerifiedAccessToken } from "../auth/auth.service";
import { authorize } from "../auth/rbac";

interface SubmitGrowthAuditBody {
  answers: Answers;
}

interface SubmitGrowthAuditResponse {
  result: AuditResult;
  notifications: NotificationEvent[];
}

/**
 * Thin HTTP layer over growth-audit.service.ts. Scoring itself is still the
 * pure, already-tested scoreAudit() function (called internally by
 * GrowthAuditService.submit()) — this controller adds no scoring behavior
 * of its own. InvalidAuditAnswersError on bad input is turned into a 400 by
 * src/common/http-exception.filter.ts rather than Nest's default 500.
 *
 * CLOSED: submissions now persist — GrowthAuditService wraps scoreAudit()
 * with a real store (in-memory, or Postgres against `growth_audit_response`
 * from db/migrations/0001 when DATABASE_URL is set). Previously a caller got
 * a correctly-scored answer for one request and nothing was kept afterward.
 *
 * Gated 2026-09-11 — closes the real gap the Platform Readiness Assessment
 * flagged: this controller had no auth guard at all, and submit() trusted a
 * bare `tenantId` in the request body. `tenantId` now comes from the
 * actor's own verified token, using the existing `growth_audit:submit`/
 * `growth_audit:view` permissions rbac.ts already defined for this exact
 * purpose but never had a caller enforce them until now.
 *
 * STILL a known gap, unrelated to the auth-guard fix above: `administered_by`
 * (nullable in the schema) is still never set — see GrowthAuditService.
 * submit()'s own comment; wiring the now-available actor.userId through
 * requires changing submit()'s own signature/store mapping, a separate
 * change from gating this endpoint.
 */
@UseGuards(AccessTokenGuard)
@Controller("growth-audit")
export class GrowthAuditController {
  constructor(
    private readonly growthAuditService: GrowthAuditService,
    private readonly notificationDelivery: NotificationDeliveryService
  ) {}

  /** Exposes the same SECTIONS/QUESTION_TEXT questions.data.ts already
   * defines and integrity-checks at import time, so a client (e.g. the
   * dashboard at GET /) renders the real 40-question instrument instead of
   * duplicating it and risking drift. No tenant-specific data here, so this
   * one route stays reachable by any authenticated user regardless of role
   * — there's no permission granular enough to gate a static question list
   * behind, and inventing one would be pure ceremony. */
  @Get("questions")
  questions(): { sections: typeof SECTIONS; questionText: typeof QUESTION_TEXT } {
    return { sections: SECTIONS, questionText: QUESTION_TEXT };
  }

  @Post()
  async submit(@CurrentUser() actor: VerifiedAccessToken, @Body() body: SubmitGrowthAuditBody): Promise<SubmitGrowthAuditResponse> {
    authorize(actor, actor.tenantId, "growth_audit:submit");
    const response = await this.growthAuditService.submit(actor.tenantId, body.answers, randomUUID());
    const notifications = notificationsForGrowthAudit(actor.tenantId, response.result);
    await this.notificationDelivery.enqueue(notifications);
    return { result: response.result, notifications };
  }

  @Get(":tenantId")
  list(@CurrentUser() actor: VerifiedAccessToken, @Param("tenantId") tenantId: string) {
    authorize(actor, tenantId, "growth_audit:view");
    return this.growthAuditService.listForTenant(tenantId);
  }
}

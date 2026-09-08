import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { GrowthAuditService, Answers, AuditResult } from "./growth-audit.service";
import { SECTIONS, QUESTION_TEXT } from "./questions.data";
import { notificationsForGrowthAudit, NotificationEvent } from "../automation/automation.service";
import { NotificationDeliveryService } from "../automation/notification-delivery.service";

interface SubmitGrowthAuditBody {
  tenantId: string;
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
 * KNOWN GAP, deliberately not built here: no auth guard on this endpoint, so
 * `administered_by` is never recorded — see GrowthAuditService.submit()'s
 * own comment.
 */
@Controller("growth-audit")
export class GrowthAuditController {
  constructor(
    private readonly growthAuditService: GrowthAuditService,
    private readonly notificationDelivery: NotificationDeliveryService
  ) {}

  /** Exposes the same SECTIONS/QUESTION_TEXT questions.data.ts already
   * defines and integrity-checks at import time, so a client (e.g. the
   * dashboard at GET /) renders the real 40-question instrument instead of
   * duplicating it and risking drift. */
  @Get("questions")
  questions(): { sections: typeof SECTIONS; questionText: typeof QUESTION_TEXT } {
    return { sections: SECTIONS, questionText: QUESTION_TEXT };
  }

  @Post()
  async submit(@Body() body: SubmitGrowthAuditBody): Promise<SubmitGrowthAuditResponse> {
    const response = await this.growthAuditService.submit(body.tenantId, body.answers, randomUUID());
    const notifications = notificationsForGrowthAudit(body.tenantId, response.result);
    await this.notificationDelivery.enqueue(notifications);
    return { result: response.result, notifications };
  }

  @Get(":tenantId")
  list(@Param("tenantId") tenantId: string) {
    return this.growthAuditService.listForTenant(tenantId);
  }
}

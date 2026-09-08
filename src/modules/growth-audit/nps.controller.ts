import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { NpsService, categorize, needsFollowUp, NpsCategory } from "./nps.service";
import { notificationsForNpsResponse, NotificationEvent } from "../automation/automation.service";
import { NotificationDeliveryService } from "../automation/notification-delivery.service";

interface SubmitNpsBody {
  tenantId: string;
  customerId: string;
  score: number;
  comment?: string;
}

interface SubmitNpsResponse {
  category: NpsCategory;
  needsFollowUp: boolean;
  notifications: NotificationEvent[];
}

/**
 * CLOSED: this used to score and react to a single response but never
 * persisted it — there was no NpsResponse repository, so computeNps() (the
 * tenant-wide %promoter − %detractor aggregate) had nothing to aggregate
 * over via HTTP. NpsService now wraps the same categorize()/computeNps()
 * pure functions with real persistence (in-memory, or Postgres against
 * `nps_response` from db/migrations/0006 when DATABASE_URL is set) — same
 * DATABASE_URL-gated pattern as every other module.
 */
@Controller("nps")
export class NpsController {
  constructor(
    private readonly npsService: NpsService,
    private readonly notificationDelivery: NotificationDeliveryService
  ) {}

  @Post()
  async submit(@Body() body: SubmitNpsBody): Promise<SubmitNpsResponse> {
    const response = await this.npsService.submit(body.tenantId, body.customerId, body.score, randomUUID(), body.comment);
    const notifications = notificationsForNpsResponse(body.tenantId, response);
    await this.notificationDelivery.enqueue(notifications);
    return {
      category: categorize(response.score),
      needsFollowUp: needsFollowUp(response),
      notifications,
    };
  }

  @Get(":tenantId/aggregate")
  aggregate(@Param("tenantId") tenantId: string) {
    return this.npsService.aggregateForTenant(tenantId);
  }
}

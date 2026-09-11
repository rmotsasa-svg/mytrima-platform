import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { IsString, IsNotEmpty, IsInt, Min, Max, IsOptional } from "class-validator";
import { NpsService, categorize, needsFollowUp, NpsCategory } from "./nps.service";
import { notificationsForNpsResponse, NotificationEvent } from "../automation/automation.service";
import { NotificationDeliveryService } from "../automation/notification-delivery.service";
import { AccessTokenGuard } from "../auth/access-token.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import { VerifiedAccessToken } from "../auth/auth.service";
import { authorize } from "../auth/rbac";
import { RateLimit } from "../../common/rate-limit.decorator";
import { RateLimitGuard } from "../../common/rate-limit.guard";

/** A real `class`, not a plain `interface` — see BookingController's own
 * comment on why. `score`'s 0–10 range mirrors categorize()'s own real
 * check in nps.service.ts. */
export class SubmitNpsBody {
  @IsString()
  @IsNotEmpty()
  tenantId!: string;

  @IsString()
  @IsNotEmpty()
  customerId!: string;

  @IsInt()
  @Min(0)
  @Max(10)
  score!: number;

  @IsOptional()
  @IsString()
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
 *
 * Reviewed 2026-09-11 as part of closing the Platform Readiness
 * Assessment's auth-guard finding: `submit()` is deliberately left
 * unauthenticated, same reasoning as RatingController.submit()/
 * BookingController.request() — a customer answering an NPS survey (sent
 * by WhatsApp/email after a purchase) is not a Mytrima account holder
 * anywhere in this system. `aggregate()`, the tenant-wide score itself, is
 * real business data and is now gated (reusing `growth_audit:view` rather
 * than inventing a separate NPS permission — the two are conceptually
 * close enough, per RecommendationController's own same choice).
 */
@Controller("nps")
export class NpsController {
  constructor(
    private readonly npsService: NpsService,
    private readonly notificationDelivery: NotificationDeliveryService
  ) {}

  /** Rate-limited 2026-09-11, same reasoning as RatingController.submit():
   * unauthenticated by design, 20 per minute per client IP. */
  @UseGuards(RateLimitGuard)
  @RateLimit({ max: 20, windowMs: 60 * 1000 })
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

  @UseGuards(AccessTokenGuard)
  @Get(":tenantId/aggregate")
  aggregate(@CurrentUser() actor: VerifiedAccessToken, @Param("tenantId") tenantId: string) {
    authorize(actor, tenantId, "growth_audit:view");
    return this.npsService.aggregateForTenant(tenantId);
  }
}

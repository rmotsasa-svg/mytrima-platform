import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { IsString, IsNotEmpty, IsInt, Min, Max, IsOptional } from "class-validator";
import { RatingService } from "./rating.service";
import { notificationsForModeratedRating, NotificationEvent } from "../automation/automation.service";
import { NotificationDeliveryService } from "../automation/notification-delivery.service";
import { AccessTokenGuard } from "../auth/access-token.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import { VerifiedAccessToken } from "../auth/auth.service";
import { authorize } from "../auth/rbac";
import { RateLimit } from "../../common/rate-limit.decorator";
import { RateLimitGuard } from "../../common/rate-limit.guard";

/** A real `class`, not a plain `interface` — see BookingController's own
 * comment on why (the global ValidationPipe in main.ts only validates
 * classes). `stars`' 1–5 range mirrors RatingService's own validateStars()
 * — checked here too so a malformed request never even reaches it. */
export class SubmitRatingBody {
  @IsString()
  @IsNotEmpty()
  tenantId!: string;

  @IsString()
  @IsNotEmpty()
  customerId!: string;

  @IsInt()
  @Min(1)
  @Max(5)
  stars!: number;

  @IsOptional()
  @IsString()
  comment?: string;
}

interface ModerateRatingBody {
  status: "public" | "hidden";
}

interface ModerateRatingResponse {
  moderated: boolean;
  notifications: NotificationEvent[];
}

/**
 * Reviewed 2026-09-11 as part of closing the Platform Readiness
 * Assessment's auth-guard finding — a real, striking find here specifically:
 * `rating:moderate`/`rating:view` have existed in rbac.ts since this
 * project's very first pass, but nothing ever actually called authorize()
 * with them until now — the exact "permission defined, unit-tested, never
 * invoked" pattern this codebase has hit before (see auth.controller.ts's
 * own comment on `user:manage`). `submit()` stays deliberately
 * unauthenticated — a customer leaving a rating is not a Mytrima account
 * holder, same reasoning as NpsController/BookingController.
 */
@Controller("ratings")
export class RatingController {
  constructor(
    private readonly ratingService: RatingService,
    private readonly notificationDelivery: NotificationDeliveryService
  ) {}

  /** Rate-limited 2026-09-11, same reasoning as /social/callback and
   * Booking's request(): unauthenticated by design, so anyone (or any bot)
   * could otherwise hammer it. 20 per minute per client IP. */
  @UseGuards(RateLimitGuard)
  @RateLimit({ max: 20, windowMs: 60 * 1000 })
  @Post()
  submit(@Body() body: SubmitRatingBody) {
    return this.ratingService.submit(body.tenantId, body.customerId, body.stars, randomUUID(), body.comment);
  }

  /**
   * CLOSED: this used to be unable to produce a notificationsForModeratedRating
   * event (see automation.service.ts) because RatingStore had no findById to
   * look up the rating's customerId/stars from just the id this endpoint
   * receives. moderate() now returns the updated Rating itself, so this
   * fires the same trigger growth-audit/nps already use — a rating hidden
   * after moderation surfaces a real NotificationEvent, matching Master Plan
   * Section 6/9's intent for this workflow. A wrong-tenant or unknown id
   * still moderates nothing and produces no notifications (moderate()
   * returns null in that case), same as before this change.
   *
   * `tenantId` now comes from the actor's own verified token, not the
   * request body — a real fix, not just a guard addition: the body no
   * longer even carries a tenantId field a caller could set to any tenant
   * it liked.
   */
  @UseGuards(AccessTokenGuard)
  @Post(":id/moderate")
  async moderate(
    @CurrentUser() actor: VerifiedAccessToken,
    @Param("id") id: string,
    @Body() body: ModerateRatingBody
  ): Promise<ModerateRatingResponse> {
    authorize(actor, actor.tenantId, "rating:moderate");
    const rating = await this.ratingService.moderate(actor.tenantId, id, body.status);
    // body.status, not rating.status: both are the same value once moderate()
    // succeeds, but body.status is already typed "public" | "hidden" — no
    // cast needed for what notificationsForModeratedRating expects.
    const notifications = rating ? notificationsForModeratedRating(actor.tenantId, rating.customerId, rating.stars, body.status) : [];
    await this.notificationDelivery.enqueue(notifications);
    return { moderated: true, notifications };
  }

  @UseGuards(AccessTokenGuard)
  @Get(":tenantId/aggregate")
  aggregate(@CurrentUser() actor: VerifiedAccessToken, @Param("tenantId") tenantId: string) {
    authorize(actor, tenantId, "rating:view");
    return this.ratingService.aggregateForTenant(tenantId);
  }
}

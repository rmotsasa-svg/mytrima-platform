import { Body, Controller, Get, NotFoundException, Param, Post, Query, UseGuards } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { IsString, IsNotEmpty, IsISO8601, IsOptional, IsNumber, IsPositive } from "class-validator";
import { BookingService } from "./booking.service";
import { notificationsForNewBookingRequest } from "../automation/automation.service";
import { NotificationDeliveryService } from "../automation/notification-delivery.service";
import { AccessTokenGuard } from "../auth/access-token.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import { VerifiedAccessToken } from "../auth/auth.service";
import { authorize } from "../auth/rbac";
import { RateLimit } from "../../common/rate-limit.decorator";
import { RateLimitGuard } from "../../common/rate-limit.guard";

/** A real `class`, not a plain `interface` — the global ValidationPipe
 * (main.ts) only validates classes with class-validator decorators; a
 * plain interface carries no runtime metadata for it to check. Converted
 * 2026-09-11 since this is the exact kind of body a stranger on the
 * internet can send directly, unauthenticated. */
export class RequestBookingBody {
  @IsString()
  @IsNotEmpty()
  customerId!: string;

  @IsString()
  @IsNotEmpty()
  catalogItemId!: string;

  @IsISO8601()
  scheduledAt!: string;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  durationMinutes?: number;

  @IsOptional()
  @IsString()
  notes?: string;
}

@Controller("bookings")
export class BookingController {
  constructor(
    private readonly bookingService: BookingService,
    private readonly notificationDelivery: NotificationDeliveryService
  ) {}

  /**
   * The one endpoint an actual customer calls — deliberately unauthenticated,
   * same as RatingController.submit()/NpsController.submit(), since a
   * customer is not a Mytrima account holder anywhere in this system (see
   * booking.service.ts's own top comment). Enqueues a real notification so
   * tenant staff know a new request is waiting — every request, not a
   * filtered subset, since each one needs a human confirm/decline decision.
   *
   * Every OTHER route below is the tenant's own staff managing that request
   * — gated 2026-09-11 closing the real gap the Platform Readiness
   * Assessment flagged for this controller. Rate-limited the same day for
   * the same reason as /social/callback: unauthenticated by design means
   * anyone (or any bot) can hammer it, 20 per minute per client IP.
   */
  @UseGuards(RateLimitGuard)
  @RateLimit({ max: 20, windowMs: 60 * 1000 })
  @Post(":tenantId")
  async request(@Param("tenantId") tenantId: string, @Body() body: RequestBookingBody) {
    const booking = await this.bookingService.requestBooking(tenantId, randomUUID(), {
      customerId: body.customerId,
      catalogItemId: body.catalogItemId,
      scheduledAt: new Date(body.scheduledAt),
      durationMinutes: body.durationMinutes,
      notes: body.notes,
    });
    await this.notificationDelivery.enqueue(notificationsForNewBookingRequest(tenantId, booking.customerId, booking.scheduledAt));
    return booking;
  }

  @UseGuards(AccessTokenGuard)
  @Get(":tenantId")
  list(
    @CurrentUser() actor: VerifiedAccessToken,
    @Param("tenantId") tenantId: string,
    @Query("periodStart") periodStart?: string,
    @Query("periodEnd") periodEnd?: string
  ) {
    authorize(actor, tenantId, "booking:view");
    return this.bookingService.listForTenant(tenantId, periodStart ? new Date(periodStart) : undefined, periodEnd ? new Date(periodEnd) : undefined);
  }

  @UseGuards(AccessTokenGuard)
  @Get(":tenantId/:bookingId")
  async getOne(@CurrentUser() actor: VerifiedAccessToken, @Param("tenantId") tenantId: string, @Param("bookingId") bookingId: string) {
    authorize(actor, tenantId, "booking:view");
    const booking = await this.bookingService.findById(tenantId, bookingId);
    if (!booking) throw new NotFoundException(`No booking found with id "${bookingId}"`);
    return booking;
  }

  @UseGuards(AccessTokenGuard)
  @Post(":tenantId/:bookingId/confirm")
  confirm(@CurrentUser() actor: VerifiedAccessToken, @Param("tenantId") tenantId: string, @Param("bookingId") bookingId: string) {
    authorize(actor, tenantId, "booking:manage");
    return this.bookingService.confirm(tenantId, bookingId);
  }

  @UseGuards(AccessTokenGuard)
  @Post(":tenantId/:bookingId/cancel")
  cancel(@CurrentUser() actor: VerifiedAccessToken, @Param("tenantId") tenantId: string, @Param("bookingId") bookingId: string) {
    authorize(actor, tenantId, "booking:manage");
    return this.bookingService.cancel(tenantId, bookingId);
  }

  @UseGuards(AccessTokenGuard)
  @Post(":tenantId/:bookingId/complete")
  complete(@CurrentUser() actor: VerifiedAccessToken, @Param("tenantId") tenantId: string, @Param("bookingId") bookingId: string) {
    authorize(actor, tenantId, "booking:manage");
    return this.bookingService.complete(tenantId, bookingId);
  }

  @UseGuards(AccessTokenGuard)
  @Post(":tenantId/:bookingId/no-show")
  markNoShow(@CurrentUser() actor: VerifiedAccessToken, @Param("tenantId") tenantId: string, @Param("bookingId") bookingId: string) {
    authorize(actor, tenantId, "booking:manage");
    return this.bookingService.markNoShow(tenantId, bookingId);
  }
}

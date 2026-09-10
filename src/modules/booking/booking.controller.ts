import { Body, Controller, Get, NotFoundException, Param, Post, Query } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { BookingService } from "./booking.service";
import { notificationsForNewBookingRequest } from "../automation/automation.service";
import { NotificationDeliveryService } from "../automation/notification-delivery.service";

interface RequestBookingBody {
  customerId: string;
  catalogItemId: string;
  scheduledAt: string;
  durationMinutes?: number;
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
   */
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

  @Get(":tenantId")
  list(@Param("tenantId") tenantId: string, @Query("periodStart") periodStart?: string, @Query("periodEnd") periodEnd?: string) {
    return this.bookingService.listForTenant(tenantId, periodStart ? new Date(periodStart) : undefined, periodEnd ? new Date(periodEnd) : undefined);
  }

  @Get(":tenantId/:bookingId")
  async getOne(@Param("tenantId") tenantId: string, @Param("bookingId") bookingId: string) {
    const booking = await this.bookingService.findById(tenantId, bookingId);
    if (!booking) throw new NotFoundException(`No booking found with id "${bookingId}"`);
    return booking;
  }

  @Post(":tenantId/:bookingId/confirm")
  confirm(@Param("tenantId") tenantId: string, @Param("bookingId") bookingId: string) {
    return this.bookingService.confirm(tenantId, bookingId);
  }

  @Post(":tenantId/:bookingId/cancel")
  cancel(@Param("tenantId") tenantId: string, @Param("bookingId") bookingId: string) {
    return this.bookingService.cancel(tenantId, bookingId);
  }

  @Post(":tenantId/:bookingId/complete")
  complete(@Param("tenantId") tenantId: string, @Param("bookingId") bookingId: string) {
    return this.bookingService.complete(tenantId, bookingId);
  }

  @Post(":tenantId/:bookingId/no-show")
  markNoShow(@Param("tenantId") tenantId: string, @Param("bookingId") bookingId: string) {
    return this.bookingService.markNoShow(tenantId, bookingId);
  }
}

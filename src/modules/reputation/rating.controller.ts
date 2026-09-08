import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { RatingService } from "./rating.service";
import { notificationsForModeratedRating, NotificationEvent } from "../automation/automation.service";
import { NotificationDeliveryService } from "../automation/notification-delivery.service";

interface SubmitRatingBody {
  tenantId: string;
  customerId: string;
  stars: number;
  comment?: string;
}

interface ModerateRatingBody {
  tenantId: string;
  status: "public" | "hidden";
}

interface ModerateRatingResponse {
  moderated: boolean;
  notifications: NotificationEvent[];
}

@Controller("ratings")
export class RatingController {
  constructor(
    private readonly ratingService: RatingService,
    private readonly notificationDelivery: NotificationDeliveryService
  ) {}

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
   */
  @Post(":id/moderate")
  async moderate(@Param("id") id: string, @Body() body: ModerateRatingBody): Promise<ModerateRatingResponse> {
    const rating = await this.ratingService.moderate(body.tenantId, id, body.status);
    // body.status, not rating.status: both are the same value once moderate()
    // succeeds, but body.status is already typed "public" | "hidden" — no
    // cast needed for what notificationsForModeratedRating expects.
    const notifications = rating ? notificationsForModeratedRating(body.tenantId, rating.customerId, rating.stars, body.status) : [];
    await this.notificationDelivery.enqueue(notifications);
    return { moderated: true, notifications };
  }

  @Get(":tenantId/aggregate")
  aggregate(@Param("tenantId") tenantId: string) {
    return this.ratingService.aggregateForTenant(tenantId);
  }
}

import { Body, Controller, Get, NotFoundException, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { IsIn, IsArray, ArrayMinSize } from "class-validator";
import { CustomerService } from "./customer.service";
import { SaleService } from "../sales/sale.service";
import { BookingService } from "../booking/booking.service";
import { TenantService } from "../auth/tenant.service";
import { EmailService, createEmailService } from "../integrations/email/email.service";
import { WhatsAppService, createWhatsAppService, WhatsAppApiError } from "../integrations/whatsapp/whatsapp.service";
import { PendingVerificationError } from "../integrations/pending-integration";
import { AccessTokenGuard } from "../auth/access-token.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import { VerifiedAccessToken } from "../auth/auth.service";
import { authorize } from "../auth/rbac";

interface CreateCustomerBody {
  displayName?: string;
  phone?: string;
  email?: string;
}

interface UpdateCustomerBody {
  displayName?: string;
  phone?: string;
  email?: string;
}

type FeedbackRequestChannel = "email" | "whatsapp";

/** A real `class`, not a plain `interface` — see BookingController's own
 * comment on why. */
export class RequestFeedbackBody {
  @IsArray()
  @ArrayMinSize(1)
  @IsIn(["email", "whatsapp"], { each: true })
  channels!: FeedbackRequestChannel[];
}

/** Gated 2026-09-11 — closes the real gap the Platform Readiness Assessment
 * flagged: this controller had no auth guard at all, and create() trusted a
 * bare `tenantId` in the request body — a caller could create a customer
 * record under ANY tenant id it felt like typing in. Now derived from the
 * actor's own verified token instead, same fix pattern already applied to
 * PaymentsController/the notification-phone endpoint. `customers:view` for
 * reads, `customers:manage` for writes. */
@UseGuards(AccessTokenGuard)
@Controller("customers")
export class CustomerController {
  // Instance fields, not constructor parameters: Nest's DI reflects
  // constructor parameter TYPES to resolve them, and an `EmailService`/
  // `WhatsAppService` interface erases to `Object` at runtime (interfaces
  // don't survive TS→JS compilation) — a default parameter value doesn't
  // save that, since Nest still resolves every declared constructor param.
  // Same env-var-presence factory pattern as notification-worker.service.ts's
  // own createWhatsAppService()/createEmailService(), just not DI-provided
  // tokens (no EMAIL_SERVICE/WhatsApp token is exported from AuthModule for
  // this controller to inject).
  private readonly emailService: EmailService = createEmailService();
  private readonly whatsAppService: WhatsAppService = createWhatsAppService();

  constructor(
    private readonly customerService: CustomerService,
    private readonly saleService: SaleService,
    private readonly bookingService: BookingService,
    private readonly tenantService: TenantService
  ) {}

  @Post()
  create(@CurrentUser() actor: VerifiedAccessToken, @Body() body: CreateCustomerBody) {
    authorize(actor, actor.tenantId, "customers:manage");
    return this.customerService.create(actor.tenantId, randomUUID(), body.displayName, body.phone, body.email);
  }

  /** `?q=` is optional — with it, filters the tenant's customer list by a
   * case-insensitive substring match on displayName/phone/email; without
   * it, behaves exactly as before (the full list). One endpoint, not a
   * separate /search path, since both return the same shape. */
  @Get(":tenantId")
  list(@CurrentUser() actor: VerifiedAccessToken, @Param("tenantId") tenantId: string, @Query("q") q?: string) {
    authorize(actor, tenantId, "customers:view");
    return q ? this.customerService.search(tenantId, q) : this.customerService.listForTenant(tenantId);
  }

  @Get(":tenantId/:customerId")
  async getOne(@CurrentUser() actor: VerifiedAccessToken, @Param("tenantId") tenantId: string, @Param("customerId") customerId: string) {
    authorize(actor, tenantId, "customers:view");
    const customer = await this.customerService.findById(tenantId, customerId);
    if (!customer) throw new NotFoundException(`No customer found with id "${customerId}"`);
    return customer;
  }

  @Patch(":tenantId/:customerId")
  update(
    @CurrentUser() actor: VerifiedAccessToken,
    @Param("tenantId") tenantId: string,
    @Param("customerId") customerId: string,
    @Body() body: UpdateCustomerBody
  ) {
    authorize(actor, tenantId, "customers:manage");
    return this.customerService.update(tenantId, customerId, body.displayName, body.phone, body.email);
  }

  /**
   * The "customer 360" view — see CustomerService.getActivity() for the
   * ratings/consent half of this (deliberately kept there — no cycle).
   * Real sales/booking history added here 2026-09-14 at the tenant's own
   * request: both are folded in at THIS layer, not inside CustomerService
   * itself — see customer.module.ts's own comment on why (BookingService
   * already depends on CustomerService, so the reverse dependency would be
   * a genuine construction-time cycle). Fetches each tenant's FULL sales/
   * booking history and filters by customerId in memory rather than
   * building a new per-customer store query — same "right-size before
   * scale" reasoning as CustomerService.search()'s own comment, appropriate
   * at this pilot's scale.
   */
  @Get(":tenantId/:customerId/activity")
  async activity(@CurrentUser() actor: VerifiedAccessToken, @Param("tenantId") tenantId: string, @Param("customerId") customerId: string) {
    authorize(actor, tenantId, "customers:view");
    const [activity, allSales, allBookings] = await Promise.all([
      this.customerService.getActivity(tenantId, customerId),
      this.saleService.listForTenant(tenantId),
      this.bookingService.listForTenant(tenantId),
    ]);
    return {
      ...activity,
      sales: allSales.filter((s) => s.customerId === customerId).sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime()),
      bookings: allBookings
        .filter((b) => b.customerId === customerId)
        .sort((a, b) => new Date(b.scheduledAt).getTime() - new Date(a.scheduledAt).getTime()),
    };
  }

  /**
   * "Request rating/NPS through WhatsApp or email" — real gap closed
   * 2026-09-14 at the tenant's own request. Was blocked on a real
   * prerequisite that didn't exist anywhere in this codebase before today:
   * a public, unauthenticated page a customer could actually land on to
   * submit a rating/NPS response at all — `POST /ratings` and `POST /nps`
   * have been public since their own first pass, but nothing ever pointed
   * a real customer at them. `FeedbackPage.tsx` (frontend, at
   * `/feedback/:tenantId/:customerId`) is that page now; `requestUrl` below
   * is a real, working link to it — not a placeholder.
   *
   * Per-channel, not all-or-nothing — same discipline as
   * DealsController.publish(): a channel with nothing to send to
   * (`customer.email`/`customer.phone` unset) or nothing configured to
   * send with is reported `skipped` with a real reason, not a fabricated
   * success or a failure of the whole request.
   *
   * DISCLOSED, NOT HIDDEN, WhatsApp gap: `WhatsAppCloudApiService.sendTemplateMessage()`
   * requires a pre-approved Meta template name, and the only one this
   * platform has ever actually sent (`hello_world`, from
   * notification-worker.service.ts) is Meta's own fixed-content sample —
   * it cannot carry `requestUrl`. `WHATSAPP_RATING_REQUEST_TEMPLATE` is a
   * new, separate env var for a real business-specific template name once
   * one is submitted and approved; unset (the honest default today), the
   * WhatsApp channel is skipped with that reason rather than sending
   * `hello_world` with a link it cannot actually contain. Email has no such
   * gap — `EmailService.sendRatingRequestEmail()` sends real, working copy
   * today, gated only on SES being configured (same as every other real
   * email this platform sends).
   */
  @Post(":tenantId/:customerId/request-feedback")
  async requestFeedback(
    @CurrentUser() actor: VerifiedAccessToken,
    @Param("tenantId") tenantId: string,
    @Param("customerId") customerId: string,
    @Body() body: RequestFeedbackBody
  ) {
    authorize(actor, tenantId, "customers:manage");
    const customer = await this.customerService.findById(tenantId, customerId);
    if (!customer) throw new NotFoundException(`No customer found with id "${customerId}"`);
    const tenant = await this.tenantService.getById(tenantId);
    const tenantName = tenant?.name ?? "your service provider";
    const requestUrl = this.buildFeedbackRequestUrl(tenantId, customerId);
    const results = await this.sendFeedbackRequest(customer, tenantName, requestUrl, body.channels);
    return { requestUrl, results };
  }

  /**
   * "Send bulk NPS/rating to all customers" — real gap closed 2026-09-14 at
   * the tenant's own request, on top of the single-customer
   * requestFeedback() above. Reuses the exact same per-customer send logic
   * (sendFeedbackRequest()) rather than a second implementation — a bulk
   * send IS just that same real per-channel skip/send/fail behavior,
   * looped, so there is nothing new to get wrong here beyond the looping
   * itself.
   *
   * Sequential, not `Promise.all()`-parallel, deliberately: this can mean
   * one email/WhatsApp send per customer in a tenant's full list, and
   * firing all of them at once risks tripping SES's or Meta's own sending
   * rate limits — a real, disclosed trade-off (slower for a large customer
   * list) rather than a silently-untested parallel path. Right-sized for
   * this pilot's customer-list scale, same reasoning as
   * CustomerService.search()'s own comment.
   *
   * Returns per-channel counts, not a per-customer breakdown — a tenant
   * with hundreds of customers doesn't need hundreds of skip reasons back,
   * most of which are the unremarkable "no email/phone on file". Real
   * per-customer detail is kept only for actual failures (a transient send
   * error), capped at 20 so one failing customer list can't blow up the
   * response — the true count is always in the per-channel summary even
   * when the detail list is capped.
   */
  @Post(":tenantId/request-feedback-bulk")
  async requestFeedbackBulk(@CurrentUser() actor: VerifiedAccessToken, @Param("tenantId") tenantId: string, @Body() body: RequestFeedbackBody) {
    authorize(actor, tenantId, "customers:manage");
    const [customers, tenant] = await Promise.all([this.customerService.listForTenant(tenantId), this.tenantService.getById(tenantId)]);
    const tenantName = tenant?.name ?? "your service provider";

    const counts: Record<FeedbackRequestChannel, { sent: number; skipped: number; failed: number }> = {
      email: { sent: 0, skipped: 0, failed: 0 },
      whatsapp: { sent: 0, skipped: 0, failed: 0 },
    };
    const failures: { customerId: string; channel: FeedbackRequestChannel; reason: string }[] = [];

    for (const customer of customers) {
      const requestUrl = this.buildFeedbackRequestUrl(tenantId, customer.id);
      const results = await this.sendFeedbackRequest(customer, tenantName, requestUrl, body.channels);
      for (const r of results) {
        counts[r.channel][r.status]++;
        if (r.status === "failed" && failures.length < 20) {
          failures.push({ customerId: customer.id, channel: r.channel, reason: r.reason ?? "unknown error" });
        }
      }
    }

    return {
      totalCustomers: customers.length,
      results: body.channels.map((channel) => ({ channel, ...counts[channel] })),
      failures,
    };
  }

  private buildFeedbackRequestUrl(tenantId: string, customerId: string): string {
    const webBaseUrl = process.env.WEB_PUBLIC_BASE_URL ?? "http://localhost:5173";
    return `${webBaseUrl}/feedback/${tenantId}/${customerId}`;
  }

  /**
   * The real per-channel send/skip/fail logic both requestFeedback() and
   * requestFeedbackBulk() share — see requestFeedback()'s own comment for
   * exactly what each outcome means and the disclosed WhatsApp-template
   * gap. Never all-or-nothing: one channel failing (or having nothing to
   * send to/with) never stops another from being attempted.
   */
  private async sendFeedbackRequest(
    customer: { id: string; email?: string; phone?: string },
    tenantName: string,
    requestUrl: string,
    channels: FeedbackRequestChannel[]
  ): Promise<{ channel: FeedbackRequestChannel; status: "sent" | "skipped" | "failed"; reason?: string }[]> {
    const results: { channel: FeedbackRequestChannel; status: "sent" | "skipped" | "failed"; reason?: string }[] = [];

    if (channels.includes("email")) {
      if (!customer.email) {
        results.push({ channel: "email", status: "skipped", reason: "This customer has no email address on file" });
      } else {
        try {
          await this.emailService.sendRatingRequestEmail(customer.email, requestUrl, tenantName);
          results.push({ channel: "email", status: "sent" });
        } catch (err) {
          results.push({ channel: "email", status: "failed", reason: err instanceof Error ? err.message : String(err) });
        }
      }
    }

    if (channels.includes("whatsapp")) {
      const templateName = process.env.WHATSAPP_RATING_REQUEST_TEMPLATE;
      if (!customer.phone) {
        results.push({ channel: "whatsapp", status: "skipped", reason: "This customer has no phone number on file" });
      } else if (!templateName) {
        results.push({
          channel: "whatsapp",
          status: "skipped",
          reason: "No approved WhatsApp template configured (WHATSAPP_RATING_REQUEST_TEMPLATE unset) — see requestFeedback()'s own comment",
        });
      } else {
        try {
          await this.whatsAppService.sendTemplateMessage(customer.phone, templateName, [requestUrl]);
          results.push({ channel: "whatsapp", status: "sent" });
        } catch (err) {
          const reason =
            err instanceof PendingVerificationError || err instanceof WhatsAppApiError
              ? err.message
              : err instanceof Error
                ? err.message
                : String(err);
          results.push({ channel: "whatsapp", status: "failed", reason });
        }
      }
    }

    return results;
  }
}

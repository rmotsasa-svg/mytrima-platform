import { Body, Controller, Get, NotFoundException, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { CustomerService } from "./customer.service";
import { SaleService } from "../sales/sale.service";
import { BookingService } from "../booking/booking.service";
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
  constructor(
    private readonly customerService: CustomerService,
    private readonly saleService: SaleService,
    private readonly bookingService: BookingService
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
}

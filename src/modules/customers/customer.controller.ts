import { Body, Controller, Get, NotFoundException, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { CustomerService } from "./customer.service";
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
  constructor(private readonly customerService: CustomerService) {}

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

  /** The "customer 360" view — see CustomerService.getActivity() for what
   * this does and deliberately does not include. */
  @Get(":tenantId/:customerId/activity")
  activity(@CurrentUser() actor: VerifiedAccessToken, @Param("tenantId") tenantId: string, @Param("customerId") customerId: string) {
    authorize(actor, tenantId, "customers:view");
    return this.customerService.getActivity(tenantId, customerId);
  }
}

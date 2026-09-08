import { Body, Controller, Get, NotFoundException, Param, Patch, Post, Query } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { CustomerService } from "./customer.service";

interface CreateCustomerBody {
  tenantId: string;
  displayName?: string;
  phone?: string;
  email?: string;
}

interface UpdateCustomerBody {
  displayName?: string;
  phone?: string;
  email?: string;
}

@Controller("customers")
export class CustomerController {
  constructor(private readonly customerService: CustomerService) {}

  @Post()
  create(@Body() body: CreateCustomerBody) {
    return this.customerService.create(body.tenantId, randomUUID(), body.displayName, body.phone, body.email);
  }

  /** `?q=` is optional — with it, filters the tenant's customer list by a
   * case-insensitive substring match on displayName/phone/email; without
   * it, behaves exactly as before (the full list). One endpoint, not a
   * separate /search path, since both return the same shape. */
  @Get(":tenantId")
  list(@Param("tenantId") tenantId: string, @Query("q") q?: string) {
    return q ? this.customerService.search(tenantId, q) : this.customerService.listForTenant(tenantId);
  }

  @Get(":tenantId/:customerId")
  async getOne(@Param("tenantId") tenantId: string, @Param("customerId") customerId: string) {
    const customer = await this.customerService.findById(tenantId, customerId);
    if (!customer) throw new NotFoundException(`No customer found with id "${customerId}"`);
    return customer;
  }

  @Patch(":tenantId/:customerId")
  update(@Param("tenantId") tenantId: string, @Param("customerId") customerId: string, @Body() body: UpdateCustomerBody) {
    return this.customerService.update(tenantId, customerId, body.displayName, body.phone, body.email);
  }

  /** The "customer 360" view — see CustomerService.getActivity() for what
   * this does and deliberately does not include. */
  @Get(":tenantId/:customerId/activity")
  activity(@Param("tenantId") tenantId: string, @Param("customerId") customerId: string) {
    return this.customerService.getActivity(tenantId, customerId);
  }
}

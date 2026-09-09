import { Body, Controller, Get, NotFoundException, Param, Post } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { DealService, DiscountType } from "./deal.service";

interface CreateDealBody {
  name: string;
  discountType: DiscountType;
  catalogItemIds: string[];
  percentageOff?: number;
  buyQuantity?: number;
  freeQuantity?: number;
  fixedAmountOff?: number;
  startsAt?: string;
  endsAt?: string;
}

@Controller("deals")
export class DealsController {
  constructor(private readonly dealService: DealService) {}

  @Post(":tenantId")
  create(@Param("tenantId") tenantId: string, @Body() body: CreateDealBody) {
    return this.dealService.create(tenantId, randomUUID(), {
      ...body,
      startsAt: body.startsAt ? new Date(body.startsAt) : undefined,
      endsAt: body.endsAt ? new Date(body.endsAt) : undefined,
    });
  }

  @Get(":tenantId")
  list(@Param("tenantId") tenantId: string) {
    return this.dealService.listForTenant(tenantId);
  }

  @Get(":tenantId/:dealId")
  async getOne(@Param("tenantId") tenantId: string, @Param("dealId") dealId: string) {
    const deal = await this.dealService.findById(tenantId, dealId);
    if (!deal) throw new NotFoundException(`No deal found with id "${dealId}"`);
    return deal;
  }
}

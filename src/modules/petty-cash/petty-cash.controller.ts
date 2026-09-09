import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { VendorService } from "./vendor.service";
import { PettyCashService } from "./petty-cash.service";

interface CreateVendorBody {
  name: string;
  contactInfo?: string;
}

interface ReplenishBody {
  amount: number;
  description?: string;
  recordedByUserId?: string;
}

interface PayVendorBody {
  vendorId: string;
  amount: number;
  description?: string;
  recordedByUserId?: string;
}

@Controller("vendors")
export class VendorController {
  constructor(private readonly vendorService: VendorService) {}

  @Post(":tenantId")
  create(@Param("tenantId") tenantId: string, @Body() body: CreateVendorBody) {
    return this.vendorService.create(tenantId, randomUUID(), body.name, body.contactInfo);
  }

  @Get(":tenantId")
  list(@Param("tenantId") tenantId: string) {
    return this.vendorService.listForTenant(tenantId);
  }
}

@Controller("petty-cash")
export class PettyCashController {
  constructor(private readonly pettyCashService: PettyCashService) {}

  @Post(":tenantId/replenish")
  replenish(@Param("tenantId") tenantId: string, @Body() body: ReplenishBody) {
    return this.pettyCashService.replenish(tenantId, randomUUID(), body.amount, body.description, body.recordedByUserId);
  }

  @Post(":tenantId/pay-vendor")
  payVendor(@Param("tenantId") tenantId: string, @Body() body: PayVendorBody) {
    return this.pettyCashService.payVendor(tenantId, randomUUID(), body.vendorId, body.amount, body.description, body.recordedByUserId);
  }

  /** The ledger plus its computed running balance, in one response — the
   * balance is never stored, always derived from the ledger itself. */
  @Get(":tenantId")
  async ledger(@Param("tenantId") tenantId: string) {
    const [transactions, balance] = await Promise.all([this.pettyCashService.getLedger(tenantId), this.pettyCashService.getBalance(tenantId)]);
    return { transactions, balance };
  }
}

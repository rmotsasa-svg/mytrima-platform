import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { VendorService } from "./vendor.service";
import { PettyCashService } from "./petty-cash.service";
import { AccessTokenGuard } from "../auth/access-token.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import { VerifiedAccessToken } from "../auth/auth.service";
import { authorize } from "../auth/rbac";
import { StaffActivityLogService } from "../auth/staff-activity.service";

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

/** Gated 2026-09-11 — closes the real gap the Platform Readiness Assessment
 * flagged. `petty_cash:manage` covers both controllers here — real cash
 * handling, no read_only use case established, same reasoning as
 * DealsController. */
@UseGuards(AccessTokenGuard)
@Controller("vendors")
export class VendorController {
  constructor(private readonly vendorService: VendorService) {}

  @Post(":tenantId")
  create(@CurrentUser() actor: VerifiedAccessToken, @Param("tenantId") tenantId: string, @Body() body: CreateVendorBody) {
    authorize(actor, tenantId, "petty_cash:manage");
    return this.vendorService.create(tenantId, randomUUID(), body.name, body.contactInfo);
  }

  @Get(":tenantId")
  list(@CurrentUser() actor: VerifiedAccessToken, @Param("tenantId") tenantId: string) {
    authorize(actor, tenantId, "petty_cash:manage");
    return this.vendorService.listForTenant(tenantId);
  }
}

@UseGuards(AccessTokenGuard)
@Controller("petty-cash")
export class PettyCashController {
  constructor(
    private readonly pettyCashService: PettyCashService,
    private readonly staffActivityLogService: StaffActivityLogService
  ) {}

  /** Manager/owner-only since 2026-09-14 (see rbac.ts's own comment) — also
   * the first of the two petty cash actions StaffActivityLogService logs;
   * recorded after a genuinely successful write, never before (same "log
   * after success" discipline as SocialPostLogService's own comment). */
  @Post(":tenantId/replenish")
  async replenish(@CurrentUser() actor: VerifiedAccessToken, @Param("tenantId") tenantId: string, @Body() body: ReplenishBody) {
    authorize(actor, tenantId, "petty_cash:manage");
    const transaction = await this.pettyCashService.replenish(tenantId, randomUUID(), body.amount, body.description, body.recordedByUserId);
    await this.staffActivityLogService.record({
      id: randomUUID(),
      tenantId,
      userId: actor.userId,
      action: "petty_cash.replenish",
      details: { amount: body.amount, description: body.description },
      occurredAt: new Date(),
    });
    return transaction;
  }

  @Post(":tenantId/pay-vendor")
  async payVendor(@CurrentUser() actor: VerifiedAccessToken, @Param("tenantId") tenantId: string, @Body() body: PayVendorBody) {
    authorize(actor, tenantId, "petty_cash:manage");
    const transaction = await this.pettyCashService.payVendor(tenantId, randomUUID(), body.vendorId, body.amount, body.description, body.recordedByUserId);
    await this.staffActivityLogService.record({
      id: randomUUID(),
      tenantId,
      userId: actor.userId,
      action: "petty_cash.pay_vendor",
      details: { amount: body.amount, vendorId: body.vendorId, description: body.description },
      occurredAt: new Date(),
    });
    return transaction;
  }

  /** The ledger plus its computed running balance, in one response — the
   * balance is never stored, always derived from the ledger itself. */
  @Get(":tenantId")
  async ledger(@CurrentUser() actor: VerifiedAccessToken, @Param("tenantId") tenantId: string) {
    authorize(actor, tenantId, "petty_cash:manage");
    const [transactions, balance] = await Promise.all([this.pettyCashService.getLedger(tenantId), this.pettyCashService.getBalance(tenantId)]);
    return { transactions, balance };
  }
}

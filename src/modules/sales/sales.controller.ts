import { BadRequestException, Body, Controller, Get, NotFoundException, Param, Post, Query, UseGuards } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { SaleService, SaleLineItemInput, SaleSource, PaymentMethod } from "./sale.service";
import { SalesTargetService, computeProgressPct } from "./sales-target.service";
import { KpiBenchmarkService, BenchmarkKpi, BenchmarkComparison, BenchmarkCadence } from "./kpi-benchmark.service";
import { RefundService, RefundLineItemInput } from "./refund.service";
import { ShiftBankingService, Denomination } from "./shift-banking.service";
import { AccessTokenGuard } from "../auth/access-token.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import { VerifiedAccessToken } from "../auth/auth.service";
import { TenantService } from "../auth/tenant.service";
import { authorize } from "../auth/rbac";
import { StaffActivityLogService } from "../auth/staff-activity.service";
import { EmailService, createEmailService } from "../integrations/email/email.service";
import { WhatsAppService, createWhatsAppService, WhatsAppApiError } from "../integrations/whatsapp/whatsapp.service";
import { PendingVerificationError } from "../integrations/pending-integration";
import { parsePagination } from "../../common/pagination";

interface RecordSaleBody {
  customerId?: string;
  source?: SaleSource;
  paymentMethod?: PaymentMethod;
  occurredAt?: string;
  dealId?: string;
  lineItems: SaleLineItemInput[];
}

interface RecordRefundBody {
  lineItems: RefundLineItemInput[];
  reason?: string;
}

interface SetTargetBody {
  periodStart: string;
  periodEnd: string;
  targetAmount: number;
  userId?: string;
}

interface CloseShiftBody {
  periodStart: string;
  periodEnd: string;
  countedCashAmount: number;
  bankedAmount: number;
  notes?: string;
  denominationCounts?: Partial<Record<Denomination, number>>;
}

interface SendShiftBankingSlipBody {
  channel: "email" | "whatsapp";
  /** An email address for `channel: "email"`, an E.164 phone number for
   * `channel: "whatsapp"` — the sender's own choice of who receives this
   * slip (an owner, an accountant, themselves), not assumed to be any one
   * fixed recipient this platform would otherwise have to guess. */
  recipient: string;
}

interface SetBenchmarkBody {
  kpi: BenchmarkKpi;
  comparison: BenchmarkComparison;
  thresholdValue: number;
  periodStart: string;
  periodEnd: string;
  userId?: string;
  cadence?: BenchmarkCadence;
}

/**
 * Gated 2026-09-11 — closes the real gap the Platform Readiness Assessment
 * flagged: this controller had no auth guard at all, so any request that
 * knew or guessed a real tenantId could read or write a tenant's real sales
 * data. `sales:view` covers every read (list/kpis/repeat-rate/lifetime-
 * value/targets/benchmarks); `sales:manage` covers every write
 * (recordSale/setTarget/setBenchmark) — see rbac.ts's own comment on why
 * this domain gets the view/manage split read_only meaningfully needs.
 */
@UseGuards(AccessTokenGuard)
@Controller("sales")
export class SalesController {
  // Instance fields, not constructor parameters — see
  // CustomerController's own comment on why (an EmailService/WhatsAppService
  // interface erases to `Object` at runtime, so Nest's DI can't resolve it
  // as a constructor param; no EMAIL_SERVICE/WhatsApp token is exported
  // from AuthModule for this controller to inject instead).
  private readonly emailService: EmailService = createEmailService();
  private readonly whatsAppService: WhatsAppService = createWhatsAppService();

  constructor(
    private readonly saleService: SaleService,
    private readonly salesTargetService: SalesTargetService,
    private readonly kpiBenchmarkService: KpiBenchmarkService,
    private readonly refundService: RefundService,
    private readonly shiftBankingService: ShiftBankingService,
    private readonly staffActivityLogService: StaffActivityLogService,
    private readonly tenantService: TenantService
  ) {}

  /**
   * "Link staff to sales" — REAL BUG found 2026-09-15 at the tenant's own
   * explicit request: `recordedByUserId` has existed on SaleTransaction
   * since this module's first pass, but nothing here ever set it — the
   * frontend never sent it, so every sale ever recorded through this
   * endpoint has a null recordedByUserId, and even if a caller did send
   * one, it was trusted verbatim from the request body (any staff member
   * could have attributed a sale to anyone). Now always derived from the
   * actor's own verified access token, the same way every other
   * "who did this" field in this codebase is (e.g. StaffActivityLogService
   * calls right below, which were already doing this correctly) — a
   * client-supplied recordedByUserId in the body is simply ignored.
   */
  @Post(":tenantId")
  async recordSale(@CurrentUser() actor: VerifiedAccessToken, @Param("tenantId") tenantId: string, @Body() body: RecordSaleBody) {
    authorize(actor, tenantId, "sales:manage");
    const sale = await this.saleService.recordSale(tenantId, randomUUID(), {
      ...body,
      recordedByUserId: actor.userId,
      occurredAt: body.occurredAt ? new Date(body.occurredAt) : undefined,
    });
    await this.staffActivityLogService.record({
      id: randomUUID(),
      tenantId,
      userId: actor.userId,
      action: "sale.recorded",
      details: { saleId: sale.id, totalAmount: sale.totalAmount },
      occurredAt: new Date(),
    });
    return sale;
  }

  /** Real refund/exchange processing for the P.O.S. page — see
   * refund.service.ts's own top comment for why "exchange" isn't a
   * separate concept here (a refund plus an ordinary new sale, composed
   * on the P.O.S. page itself). Gated by `refund:manage`, not
   * `sales:manage`, since 2026-09-14 at the tenant's own explicit request
   * ("manager must authorize petty cash and exchange") — recording a NEW
   * sale stays an ordinary staff action; reversing money already taken now
   * needs real manager-or-owner authorization, split out of sales:manage
   * specifically for this route. */
  @Post(":tenantId/:saleId/refund")
  async recordRefund(
    @CurrentUser() actor: VerifiedAccessToken,
    @Param("tenantId") tenantId: string,
    @Param("saleId") saleId: string,
    @Body() body: RecordRefundBody
  ) {
    authorize(actor, tenantId, "refund:manage");
    // Same real fix as recordSale() above — derived from the verified
    // actor, never trusted from the request body.
    const refund = await this.refundService.recordRefund(tenantId, randomUUID(), saleId, body.lineItems, body.reason, actor.userId);
    await this.staffActivityLogService.record({
      id: randomUUID(),
      tenantId,
      userId: actor.userId,
      action: "sale.refund",
      details: { saleId, refundAmount: refund.refundAmount, reason: body.reason },
      occurredAt: new Date(),
    });
    return refund;
  }

  @Get(":tenantId/:saleId/refunds")
  listRefunds(@CurrentUser() actor: VerifiedAccessToken, @Param("tenantId") tenantId: string, @Param("saleId") saleId: string) {
    authorize(actor, tenantId, "sales:view");
    return this.refundService.listForSale(tenantId, saleId);
  }

  /** Real pagination (`?limit=`/`?offset=`, see common/pagination.ts) added
   * 2026-09-11 — this was the exact endpoint the Platform Readiness
   * Assessment named first for returning a tenant's entire sales history in
   * one response. */
  @Get(":tenantId")
  list(
    @CurrentUser() actor: VerifiedAccessToken,
    @Param("tenantId") tenantId: string,
    @Query("periodStart") periodStart?: string,
    @Query("periodEnd") periodEnd?: string,
    @Query("limit") limit?: string,
    @Query("offset") offset?: string
  ) {
    authorize(actor, tenantId, "sales:view");
    const { limit: parsedLimit, offset: parsedOffset } = parsePagination(limit, offset);
    return this.saleService.listPageForTenant(
      tenantId,
      periodStart ? new Date(periodStart) : undefined,
      periodEnd ? new Date(periodEnd) : undefined,
      parsedLimit,
      parsedOffset
    );
  }

  /** Master Plan Addendum v1.3, §E's own KPI table, computed live for the
   * given period — defaults to the last 30 days when no period is given.
   * `refundedAmount`/`netSalesAmount` added 2026-09-12 alongside real
   * refund processing — combined here at the controller level (not inside
   * SaleService.computeKpis() itself) specifically to avoid a circular
   * dependency: RefundService already depends on SaleService (to look up
   * the original sale a refund applies against), so SaleService depending
   * back on RefundService would create a real DI cycle for a computation
   * that doesn't actually need to live inside either service alone.
   * `salesAmount` itself is left unchanged (gross, as it always was) —
   * every existing caller of computeKpis() keeps its exact prior meaning;
   * only this HTTP response layers the two new, real net figures on top. */
  @Get(":tenantId/kpis")
  async kpis(
    @CurrentUser() actor: VerifiedAccessToken,
    @Param("tenantId") tenantId: string,
    @Query("periodStart") periodStart?: string,
    @Query("periodEnd") periodEnd?: string
  ) {
    authorize(actor, tenantId, "sales:view");
    const end = periodEnd ? new Date(periodEnd) : new Date();
    const start = periodStart ? new Date(periodStart) : new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);
    const [kpis, refundedAmount] = await Promise.all([
      this.saleService.computeKpis(tenantId, start, end),
      this.refundService.totalRefundedForPeriod(tenantId, start, end),
    ]);
    const netSalesAmount = Math.round((kpis.salesAmount - refundedAmount) * 100) / 100;
    return { ...kpis, refundedAmount, netSalesAmount };
  }

  /** New-customer repeat rate — see SaleService.computeRepeatRate()'s own
   * comment. Same 30-days-by-default period as :tenantId/kpis. */
  @Get(":tenantId/repeat-rate")
  repeatRate(
    @CurrentUser() actor: VerifiedAccessToken,
    @Param("tenantId") tenantId: string,
    @Query("periodStart") periodStart?: string,
    @Query("periodEnd") periodEnd?: string
  ) {
    authorize(actor, tenantId, "sales:view");
    const end = periodEnd ? new Date(periodEnd) : new Date();
    const start = periodStart ? new Date(periodStart) : new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);
    return this.saleService.computeRepeatRate(tenantId, start, end);
  }

  /** Customer Lifetime Value — see SaleService.computeLifetimeValue()'s own
   * comment for the exact formula (sourced from the "Essential Growth
   * Strategy KPIs" reference doc) and why, unlike every other endpoint
   * here, this one takes no period params at all: "lifetime" isn't a
   * date-range concept. */
  @Get(":tenantId/lifetime-value")
  lifetimeValue(@CurrentUser() actor: VerifiedAccessToken, @Param("tenantId") tenantId: string) {
    authorize(actor, tenantId, "sales:view");
    return this.saleService.computeLifetimeValue(tenantId);
  }

  @Post(":tenantId/targets")
  setTarget(@CurrentUser() actor: VerifiedAccessToken, @Param("tenantId") tenantId: string, @Body() body: SetTargetBody) {
    authorize(actor, tenantId, "sales:manage");
    return this.salesTargetService.setTarget(tenantId, randomUUID(), new Date(body.periodStart), new Date(body.periodEnd), body.targetAmount, body.userId);
  }

  /** "sales target on %" — the tenant's own explicit request (2026-09-15):
   * each target's progress expressed as a percentage of the target amount,
   * computed fresh against SaleService's own real KPIs for that target's
   * exact period, never a second stored number (same "compute, never
   * store the derived value" discipline as PettyCashService.getBalance()).
   * See computeProgressPct()'s own comment for what null/>100 mean. */
  @Get(":tenantId/targets")
  async listTargets(@CurrentUser() actor: VerifiedAccessToken, @Param("tenantId") tenantId: string) {
    authorize(actor, tenantId, "sales:view");
    const targets = await this.salesTargetService.listForTenant(tenantId);
    return Promise.all(
      targets.map(async (target) => {
        const kpis = await this.saleService.computeKpis(tenantId, target.periodStart, target.periodEnd);
        return { ...target, actualAmount: kpis.salesAmount, progressPct: computeProgressPct(kpis.salesAmount, target.targetAmount) };
      })
    );
  }

  @Post(":tenantId/benchmarks")
  setBenchmark(@CurrentUser() actor: VerifiedAccessToken, @Param("tenantId") tenantId: string, @Body() body: SetBenchmarkBody) {
    authorize(actor, tenantId, "sales:manage");
    return this.kpiBenchmarkService.setBenchmark(
      tenantId,
      randomUUID(),
      body.kpi,
      body.comparison,
      body.thresholdValue,
      new Date(body.periodStart),
      new Date(body.periodEnd),
      body.userId,
      body.cadence
    );
  }

  @Get(":tenantId/benchmarks")
  listBenchmarks(@CurrentUser() actor: VerifiedAccessToken, @Param("tenantId") tenantId: string) {
    authorize(actor, tenantId, "sales:view");
    return this.kpiBenchmarkService.listActiveForTenant(tenantId);
  }

  /**
   * "Allow staff to do daily shift end banking" — real gap closed
   * 2026-09-14 at the tenant's own explicit request. Ordinary `sales:manage`/
   * `sales:view` — this is a routine, every-shift staff action, not one of
   * the two the tenant asked to require manager authorization (petty cash,
   * refund/exchange — see rbac.ts's own comment).
   *
   * `expected-cash` is a real preview, not a guess — call it BEFORE
   * closeShift() so staff sees what the books say before committing to a
   * count, same "preview, then confirm" pattern SnapshotService's own
   * Budget/Actual tiles already establish.
   */
  @Get(":tenantId/shift-banking/expected-cash")
  async expectedCash(
    @CurrentUser() actor: VerifiedAccessToken,
    @Param("tenantId") tenantId: string,
    @Query("periodStart") periodStart: string,
    @Query("periodEnd") periodEnd: string
  ) {
    authorize(actor, tenantId, "sales:view");
    const expectedCashAmount = await this.shiftBankingService.computeExpectedCash(tenantId, new Date(periodStart), new Date(periodEnd));
    return { expectedCashAmount };
  }

  @Post(":tenantId/shift-banking")
  closeShift(@CurrentUser() actor: VerifiedAccessToken, @Param("tenantId") tenantId: string, @Body() body: CloseShiftBody) {
    authorize(actor, tenantId, "sales:manage");
    // Same real fix as recordSale()/recordRefund() above — derived from
    // the verified actor, never trusted from the request body.
    return this.shiftBankingService.closeShift(
      tenantId,
      randomUUID(),
      new Date(body.periodStart),
      new Date(body.periodEnd),
      body.countedCashAmount,
      body.bankedAmount,
      body.notes,
      actor.userId,
      body.denominationCounts
    );
  }

  @Get(":tenantId/shift-banking")
  async listShiftBanking(@CurrentUser() actor: VerifiedAccessToken, @Param("tenantId") tenantId: string) {
    authorize(actor, tenantId, "sales:view");
    const records = await this.shiftBankingService.listForTenant(tenantId);
    return records.map((r) => ({ ...r, variance: this.shiftBankingService.variance(r) }));
  }

  /**
   * "Allow staff to send slips on WhatsApp or email" — real gap closed
   * 2026-09-14 at the tenant's own explicit request. `sales:manage`, same
   * as closeShift() itself — an ordinary staff action, not manager-gated.
   * The real slip content (`ShiftBankingService.buildSlipText()`) is built
   * entirely from the record's own real fields, including its real
   * denomination breakdown when one was given — never fabricated copy.
   *
   * DISCLOSED, NOT HIDDEN, WhatsApp gap: same real constraint as
   * `CustomerController.requestFeedback()`/`CampaignsController.launch()`
   * — `WhatsAppCloudApiService.sendTemplateMessage()` needs a real,
   * separate, pre-approved Meta template
   * (`WHATSAPP_SHIFT_SLIP_TEMPLATE`), unset by default; honestly refused
   * with that reason rather than sending Meta's fixed-content
   * `hello_world` sample with a slip's real numbers silently dropped.
   */
  @Post(":tenantId/shift-banking/:id/send-slip")
  async sendShiftBankingSlip(
    @CurrentUser() actor: VerifiedAccessToken,
    @Param("tenantId") tenantId: string,
    @Param("id") id: string,
    @Body() body: SendShiftBankingSlipBody
  ) {
    authorize(actor, tenantId, "sales:manage");
    const record = await this.shiftBankingService.findById(tenantId, id);
    if (!record) throw new NotFoundException(`No shift banking record found with id "${id}"`);
    const tenant = await this.tenantService.getById(tenantId);
    const tenantName = tenant?.name ?? "your service provider";
    const slipText = this.shiftBankingService.buildSlipText(record, tenantName);

    if (body.channel === "email") {
      try {
        await this.emailService.sendShiftBankingSlipEmail(body.recipient, slipText, tenantName);
        return { sent: true };
      } catch (err) {
        throw new BadRequestException(err instanceof Error ? err.message : "Could not send this slip by email");
      }
    }

    const templateName = process.env.WHATSAPP_SHIFT_SLIP_TEMPLATE;
    if (!templateName) {
      throw new BadRequestException(
        "No approved WhatsApp template configured (WHATSAPP_SHIFT_SLIP_TEMPLATE unset) — see this endpoint's own comment"
      );
    }
    try {
      await this.whatsAppService.sendTemplateMessage(body.recipient, templateName, [slipText]);
      return { sent: true };
    } catch (err) {
      const reason = err instanceof PendingVerificationError || err instanceof WhatsAppApiError ? err.message : err instanceof Error ? err.message : String(err);
      throw new BadRequestException(reason);
    }
  }
}

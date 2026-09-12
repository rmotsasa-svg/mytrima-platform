import { Body, Controller, Get, Param, Post, Query, UseGuards } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { SaleService, SaleLineItemInput, SaleSource } from "./sale.service";
import { SalesTargetService } from "./sales-target.service";
import { KpiBenchmarkService, BenchmarkKpi, BenchmarkComparison } from "./kpi-benchmark.service";
import { RefundService, RefundLineItemInput } from "./refund.service";
import { AccessTokenGuard } from "../auth/access-token.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import { VerifiedAccessToken } from "../auth/auth.service";
import { authorize } from "../auth/rbac";
import { parsePagination } from "../../common/pagination";

interface RecordSaleBody {
  customerId?: string;
  recordedByUserId?: string;
  source?: SaleSource;
  occurredAt?: string;
  dealId?: string;
  lineItems: SaleLineItemInput[];
}

interface RecordRefundBody {
  lineItems: RefundLineItemInput[];
  reason?: string;
  recordedByUserId?: string;
}

interface SetTargetBody {
  periodStart: string;
  periodEnd: string;
  targetAmount: number;
  userId?: string;
}

interface SetBenchmarkBody {
  kpi: BenchmarkKpi;
  comparison: BenchmarkComparison;
  thresholdValue: number;
  periodStart: string;
  periodEnd: string;
  userId?: string;
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
  constructor(
    private readonly saleService: SaleService,
    private readonly salesTargetService: SalesTargetService,
    private readonly kpiBenchmarkService: KpiBenchmarkService,
    private readonly refundService: RefundService
  ) {}

  @Post(":tenantId")
  recordSale(@CurrentUser() actor: VerifiedAccessToken, @Param("tenantId") tenantId: string, @Body() body: RecordSaleBody) {
    authorize(actor, tenantId, "sales:manage");
    return this.saleService.recordSale(tenantId, randomUUID(), { ...body, occurredAt: body.occurredAt ? new Date(body.occurredAt) : undefined });
  }

  /** Real refund/exchange processing for the P.O.S. page — see
   * refund.service.ts's own top comment for why "exchange" isn't a
   * separate concept here (a refund plus an ordinary new sale, composed
   * on the P.O.S. page itself). */
  @Post(":tenantId/:saleId/refund")
  recordRefund(
    @CurrentUser() actor: VerifiedAccessToken,
    @Param("tenantId") tenantId: string,
    @Param("saleId") saleId: string,
    @Body() body: RecordRefundBody
  ) {
    authorize(actor, tenantId, "sales:manage");
    return this.refundService.recordRefund(tenantId, randomUUID(), saleId, body.lineItems, body.reason, body.recordedByUserId);
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

  @Get(":tenantId/targets")
  listTargets(@CurrentUser() actor: VerifiedAccessToken, @Param("tenantId") tenantId: string) {
    authorize(actor, tenantId, "sales:view");
    return this.salesTargetService.listForTenant(tenantId);
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
      body.userId
    );
  }

  @Get(":tenantId/benchmarks")
  listBenchmarks(@CurrentUser() actor: VerifiedAccessToken, @Param("tenantId") tenantId: string) {
    authorize(actor, tenantId, "sales:view");
    return this.kpiBenchmarkService.listActiveForTenant(tenantId);
  }
}

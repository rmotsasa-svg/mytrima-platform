import { Body, Controller, Get, Param, Post, Query, UseGuards } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { SaleService, SaleLineItemInput, SaleSource } from "./sale.service";
import { SalesTargetService } from "./sales-target.service";
import { KpiBenchmarkService, BenchmarkKpi, BenchmarkComparison } from "./kpi-benchmark.service";
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
    private readonly kpiBenchmarkService: KpiBenchmarkService
  ) {}

  @Post(":tenantId")
  recordSale(@CurrentUser() actor: VerifiedAccessToken, @Param("tenantId") tenantId: string, @Body() body: RecordSaleBody) {
    authorize(actor, tenantId, "sales:manage");
    return this.saleService.recordSale(tenantId, randomUUID(), { ...body, occurredAt: body.occurredAt ? new Date(body.occurredAt) : undefined });
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
   * given period — defaults to the last 30 days when no period is given. */
  @Get(":tenantId/kpis")
  kpis(
    @CurrentUser() actor: VerifiedAccessToken,
    @Param("tenantId") tenantId: string,
    @Query("periodStart") periodStart?: string,
    @Query("periodEnd") periodEnd?: string
  ) {
    authorize(actor, tenantId, "sales:view");
    const end = periodEnd ? new Date(periodEnd) : new Date();
    const start = periodStart ? new Date(periodStart) : new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);
    return this.saleService.computeKpis(tenantId, start, end);
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

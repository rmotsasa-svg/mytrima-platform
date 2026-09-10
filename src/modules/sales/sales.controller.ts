import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { SaleService, SaleLineItemInput, SaleSource } from "./sale.service";
import { SalesTargetService } from "./sales-target.service";
import { KpiBenchmarkService, BenchmarkKpi, BenchmarkComparison } from "./kpi-benchmark.service";

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

@Controller("sales")
export class SalesController {
  constructor(
    private readonly saleService: SaleService,
    private readonly salesTargetService: SalesTargetService,
    private readonly kpiBenchmarkService: KpiBenchmarkService
  ) {}

  @Post(":tenantId")
  recordSale(@Param("tenantId") tenantId: string, @Body() body: RecordSaleBody) {
    return this.saleService.recordSale(tenantId, randomUUID(), { ...body, occurredAt: body.occurredAt ? new Date(body.occurredAt) : undefined });
  }

  @Get(":tenantId")
  list(@Param("tenantId") tenantId: string, @Query("periodStart") periodStart?: string, @Query("periodEnd") periodEnd?: string) {
    return this.saleService.listForTenant(tenantId, periodStart ? new Date(periodStart) : undefined, periodEnd ? new Date(periodEnd) : undefined);
  }

  /** Master Plan Addendum v1.3, §E's own KPI table, computed live for the
   * given period — defaults to the last 30 days when no period is given. */
  @Get(":tenantId/kpis")
  kpis(@Param("tenantId") tenantId: string, @Query("periodStart") periodStart?: string, @Query("periodEnd") periodEnd?: string) {
    const end = periodEnd ? new Date(periodEnd) : new Date();
    const start = periodStart ? new Date(periodStart) : new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);
    return this.saleService.computeKpis(tenantId, start, end);
  }

  /** Customer Lifetime Value — see SaleService.computeLifetimeValue()'s own
   * comment for the exact formula (sourced from the "Essential Growth
   * Strategy KPIs" reference doc) and why, unlike every other endpoint
   * here, this one takes no period params at all: "lifetime" isn't a
   * date-range concept. */
  @Get(":tenantId/lifetime-value")
  lifetimeValue(@Param("tenantId") tenantId: string) {
    return this.saleService.computeLifetimeValue(tenantId);
  }

  @Post(":tenantId/targets")
  setTarget(@Param("tenantId") tenantId: string, @Body() body: SetTargetBody) {
    return this.salesTargetService.setTarget(tenantId, randomUUID(), new Date(body.periodStart), new Date(body.periodEnd), body.targetAmount, body.userId);
  }

  @Get(":tenantId/targets")
  listTargets(@Param("tenantId") tenantId: string) {
    return this.salesTargetService.listForTenant(tenantId);
  }

  @Post(":tenantId/benchmarks")
  setBenchmark(@Param("tenantId") tenantId: string, @Body() body: SetBenchmarkBody) {
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
  listBenchmarks(@Param("tenantId") tenantId: string) {
    return this.kpiBenchmarkService.listActiveForTenant(tenantId);
  }
}

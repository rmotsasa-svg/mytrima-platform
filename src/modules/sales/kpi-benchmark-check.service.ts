import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Pool } from "pg";
import { Queue, Worker, Job } from "bullmq";
import { PG_POOL } from "../../common/database.module";
import { KpiBenchmarkService, KPI_TO_SALES_FIELD } from "./kpi-benchmark.service";
import { SaleService } from "./sale.service";
import { notificationsForKpiBenchmarkBreach } from "../automation/automation.service";
import { NotificationDeliveryService } from "../automation/notification-delivery.service";

const KPI_BENCHMARK_QUEUE_NAME = "kpi-benchmark-check";
const KPI_BENCHMARK_JOB_NAME = "check-kpi-benchmarks";

/**
 * Master Plan Addendum v1.3, Section E ("KPI benchmarks & automated
 * alerts"): the scheduled comparison job the fourth automation trigger
 * needs, since a KPI benchmark isn't a single event to hook into — it's a
 * period aggregate. Same proven pattern as RevokedTokenCleanupService: a
 * real daily BullMQ job scheduler, active only when both DATABASE_URL and
 * REDIS_URL are set.
 *
 * Iterates per-tenant via SaleService/KpiBenchmarkService (both already
 * tenant-scoped through runWithTenantContext) rather than any plain
 * cross-tenant query — the exact discipline src/common/postgres.ts documents
 * for why a plain query must never touch an RLS-protected table on a pooled
 * connection.
 */
@Injectable()
export class KpiBenchmarkCheckService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(KpiBenchmarkCheckService.name);
  private queue: Queue | null = null;
  private worker: Worker | null = null;

  constructor(
    @Inject(PG_POOL) private readonly pool: Pool | null,
    private readonly kpiBenchmarkService: KpiBenchmarkService,
    private readonly saleService: SaleService,
    private readonly notificationDelivery: NotificationDeliveryService
  ) {}

  /** Exposed as its own public method (not buried in the worker's processor
   * callback) for the same reason RevokedTokenCleanupService.deleteExpired()
   * is: the comparison logic and the scheduling mechanism are two separately
   * verifiable claims. */
  async checkAllTenants(): Promise<number> {
    if (!this.pool) return 0;
    const tenants = await this.pool.query<{ id: string }>("select id from tenant");
    let totalBreaches = 0;
    for (const { id: tenantId } of tenants.rows) {
      const benchmarks = await this.kpiBenchmarkService.listActiveForTenant(tenantId);
      for (const benchmark of benchmarks) {
        const kpis = await this.saleService.computeKpis(tenantId, benchmark.periodStart, benchmark.periodEnd);
        const breached = this.kpiBenchmarkService.checkBreach(benchmark, kpis);
        if (breached !== true) continue; // false = within range, null = no data yet for this KPI
        const fieldName = KPI_TO_SALES_FIELD[benchmark.kpi];
        const value = fieldName ? (kpis[fieldName] as number | null) : null;
        const notifications = notificationsForKpiBenchmarkBreach(tenantId, benchmark.kpi, value ?? 0, benchmark.thresholdValue, benchmark.comparison);
        await this.notificationDelivery.enqueue(notifications);
        totalBreaches++;
      }
    }
    return totalBreaches;
  }

  async onModuleInit(): Promise<void> {
    if (!this.pool || !process.env.REDIS_URL) return;
    this.queue = new Queue(KPI_BENCHMARK_QUEUE_NAME, { connection: { url: process.env.REDIS_URL } });
    await this.queue.upsertJobScheduler(KPI_BENCHMARK_JOB_NAME, { every: 24 * 60 * 60 * 1000 }, { name: KPI_BENCHMARK_JOB_NAME });

    this.worker = new Worker(
      KPI_BENCHMARK_QUEUE_NAME,
      async (job: Job) => {
        if (job.name !== KPI_BENCHMARK_JOB_NAME) return;
        const breaches = await this.checkAllTenants();
        this.logger.log(`Checked KPI benchmarks: ${breaches} breach(es) found and enqueued`);
      },
      { connection: { url: process.env.REDIS_URL } }
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
  }
}

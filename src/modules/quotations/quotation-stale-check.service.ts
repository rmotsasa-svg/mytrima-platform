import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Pool } from "pg";
import { Queue, Worker, Job } from "bullmq";
import { PG_POOL } from "../../common/database.module";
import { QuotationService, Quotation, isConvertibleToSale } from "./quotation.service";
import { notificationsForStaleQuotation } from "../automation/automation.service";
import { NotificationDeliveryService } from "../automation/notification-delivery.service";
import { TriggerService } from "../triggers/trigger.service";

export const QUOTATION_STALE_QUEUE_NAME = "quotation-stale-check";
const QUOTATION_STALE_JOB_NAME = "check-stale-quotations";

/** Same cadence and same reasoning as CrmStaleLeadCheckService's own
 * STALE_LEAD_THRESHOLD_DAYS — a real week of normal follow-up before a
 * sent quotation is flagged, not a guessed-short window. */
const STALE_QUOTATION_THRESHOLD_DAYS = 7;

/** Pure, side-effect-free — same discipline as
 * crm-stale-lead-check.service.ts's own daysSinceActivity()/isLeadStale().
 * A quotation with no sentAt (still a draft) has no clock at all — there's
 * nothing sent yet to go cold. A quotation already converted (see
 * isConvertibleToSale()'s own comment) is done, the same way a won/lost
 * CRM lead is done. */
export function daysSinceSent(sentAt: Date, now: Date): number {
  return Math.floor((now.getTime() - sentAt.getTime()) / (24 * 60 * 60 * 1000));
}

export function isQuotationStale(quotation: Pick<Quotation, "status" | "sentAt" | "convertedToSaleId">, thresholdDays: number, now: Date): boolean {
  if (!quotation.sentAt) return false;
  if (!isConvertibleToSale({ status: quotation.status, convertedToSaleId: quotation.convertedToSaleId })) return false;
  return daysSinceSent(quotation.sentAt, now) >= thresholdDays;
}

/**
 * P2.1 of "ACTION PROPOSED ADDITIONS IN PRIORITY ORDER" — the seventh real
 * trigger, mirroring CrmStaleLeadCheckService exactly: a real daily BullMQ
 * job, active only when both DATABASE_URL and REDIS_URL are set — iterates
 * per-tenant via QuotationService (already tenant-scoped through
 * runWithTenantContext), never a plain cross-tenant query, for the same
 * RLS reason src/common/postgres.ts documents.
 */
@Injectable()
export class QuotationStaleCheckService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(QuotationStaleCheckService.name);
  private queue: Queue | null = null;
  private worker: Worker | null = null;

  constructor(
    @Inject(PG_POOL) private readonly pool: Pool | null,
    private readonly quotationService: QuotationService,
    private readonly notificationDelivery: NotificationDeliveryService,
    private readonly triggerService: TriggerService
  ) {}

  /** Exposed as its own public method, same reasoning as
   * CrmStaleLeadCheckService.checkAllTenants()'s own comment. */
  async checkAllTenants(): Promise<number> {
    if (!this.pool) return 0;
    const tenants = await this.pool.query<{ id: string }>("select id from tenant");
    const now = new Date();
    let totalStale = 0;
    for (const { id: tenantId } of tenants.rows) {
      const quotations = await this.quotationService.listForTenant(tenantId);
      for (const quotation of quotations) {
        if (!isQuotationStale(quotation, STALE_QUOTATION_THRESHOLD_DAYS, now)) continue;
        const notifications = notificationsForStaleQuotation(tenantId, quotation.quoteNumber, daysSinceSent(quotation.sentAt as Date, now));
        await this.notificationDelivery.enqueue(notifications);
        await this.triggerService.record(tenantId, notifications);
        totalStale++;
      }
    }
    return totalStale;
  }

  async onModuleInit(): Promise<void> {
    if (!this.pool || !process.env.REDIS_URL) return;
    this.queue = new Queue(QUOTATION_STALE_QUEUE_NAME, { connection: { url: process.env.REDIS_URL } });
    await this.queue.upsertJobScheduler(QUOTATION_STALE_JOB_NAME, { every: 24 * 60 * 60 * 1000 }, { name: QUOTATION_STALE_JOB_NAME });

    this.worker = new Worker(
      QUOTATION_STALE_QUEUE_NAME,
      async (job: Job) => {
        if (job.name !== QUOTATION_STALE_JOB_NAME) return;
        const stale = await this.checkAllTenants();
        this.logger.log(`Checked quotations for staleness: ${stale} stale quotation(s) found and flagged`);
      },
      { connection: { url: process.env.REDIS_URL } }
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
  }
}

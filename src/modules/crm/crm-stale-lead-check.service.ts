import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Pool } from "pg";
import { Queue, Worker, Job } from "bullmq";
import { PG_POOL } from "../../common/database.module";
import { CrmService, Lead } from "./crm.service";
import { notificationsForStaleLead } from "../automation/automation.service";
import { NotificationDeliveryService } from "../automation/notification-delivery.service";
import { TriggerService } from "../triggers/trigger.service";

export const CRM_STALE_LEAD_QUEUE_NAME = "crm-stale-lead-check";
const CRM_STALE_LEAD_JOB_NAME = "check-stale-leads";

/** Default matches KpiBenchmarkCheckService's own cadence (once a day) and
 * gives a real lead a real week of normal follow-up cadence before it's
 * flagged — not a guessed-short window that would flag every lead a
 * salesperson hasn't gotten to yet on day 2. */
const STALE_LEAD_THRESHOLD_DAYS = 7;

/** Pure, side-effect-free — same "extract the real decision into a
 * standalone function so it's testable without a database" discipline as
 * KpiBenchmarkService.checkBreach(). A closed lead (won or lost) has no
 * clock at all: there's nothing left to "follow up before it goes cold"
 * on. `daysSinceActivity` is floor()'d — a lead at exactly the threshold
 * boundary (e.g. 7.9 days) hasn't crossed it yet, matching how a human
 * would describe it ("it's been a week," not "almost eight days"). */
export function daysSinceActivity(lastActivityAt: Date, now: Date): number {
  return Math.floor((now.getTime() - lastActivityAt.getTime()) / (24 * 60 * 60 * 1000));
}

export function isLeadStale(lead: Pick<Lead, "stage" | "lastActivityAt">, thresholdDays: number, now: Date): boolean {
  if (lead.stage === "won" || lead.stage === "lost") return false;
  return daysSinceActivity(lead.lastActivityAt, now) >= thresholdDays;
}

/**
 * Phase 5 of the GrowthOS-aligned restructuring plan — the "7 opportunities
 * haven't been followed up" example from the source GrowthOS proposal,
 * built on this session's own real Trigger persistence layer (Phase 2)
 * instead of invented. Same proven scheduled-job pattern as
 * KpiBenchmarkCheckService: a real daily BullMQ job, active only when both
 * DATABASE_URL and REDIS_URL are set — iterates per-tenant via CrmService
 * (already tenant-scoped through runWithTenantContext), never a plain
 * cross-tenant query, for the same RLS reason src/common/postgres.ts
 * documents.
 */
@Injectable()
export class CrmStaleLeadCheckService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CrmStaleLeadCheckService.name);
  private queue: Queue | null = null;
  private worker: Worker | null = null;

  constructor(
    @Inject(PG_POOL) private readonly pool: Pool | null,
    private readonly crmService: CrmService,
    private readonly notificationDelivery: NotificationDeliveryService,
    private readonly triggerService: TriggerService
  ) {}

  /** Exposed as its own public method, same reasoning as
   * KpiBenchmarkCheckService.checkAllTenants()'s own comment: the
   * comparison logic and the scheduling mechanism are two separately
   * verifiable claims. */
  async checkAllTenants(): Promise<number> {
    if (!this.pool) return 0;
    const tenants = await this.pool.query<{ id: string }>("select id from tenant");
    const now = new Date();
    let totalStale = 0;
    for (const { id: tenantId } of tenants.rows) {
      const leads = await this.crmService.listForTenant(tenantId);
      for (const lead of leads) {
        if (!isLeadStale(lead, STALE_LEAD_THRESHOLD_DAYS, now)) continue;
        const notifications = notificationsForStaleLead(tenantId, lead.name, daysSinceActivity(lead.lastActivityAt, now));
        await this.notificationDelivery.enqueue(notifications);
        await this.triggerService.record(tenantId, notifications);
        totalStale++;
      }
    }
    return totalStale;
  }

  async onModuleInit(): Promise<void> {
    if (!this.pool || !process.env.REDIS_URL) return;
    this.queue = new Queue(CRM_STALE_LEAD_QUEUE_NAME, { connection: { url: process.env.REDIS_URL } });
    await this.queue.upsertJobScheduler(CRM_STALE_LEAD_JOB_NAME, { every: 24 * 60 * 60 * 1000 }, { name: CRM_STALE_LEAD_JOB_NAME });

    this.worker = new Worker(
      CRM_STALE_LEAD_QUEUE_NAME,
      async (job: Job) => {
        if (job.name !== CRM_STALE_LEAD_JOB_NAME) return;
        const stale = await this.checkAllTenants();
        this.logger.log(`Checked CRM leads for staleness: ${stale} stale lead(s) found and flagged`);
      },
      { connection: { url: process.env.REDIS_URL } }
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
  }
}

import { Inject, Injectable, OnModuleDestroy } from "@nestjs/common";
import { Pool } from "pg";
import { Queue } from "bullmq";
import { PG_POOL } from "../../common/database.module";
import { NOTIFICATION_QUEUE_NAME } from "../../common/queue.module";
import { CLEANUP_QUEUE_NAME } from "../auth/revoked-token-cleanup.service";
import { SUBSCRIPTION_BILLING_QUEUE_NAME } from "../billing/subscription-billing-check.service";
import { CRM_STALE_LEAD_QUEUE_NAME } from "../crm/crm-stale-lead-check.service";
import { QUOTATION_STALE_QUEUE_NAME } from "../quotations/quotation-stale-check.service";
import { KPI_BENCHMARK_QUEUE_NAME } from "../sales/kpi-benchmark-check.service";
import { SupportTicketAdminService } from "./support-ticket-admin.service";
import { TIER_PRICING_ZAR, PaidTier } from "../billing/subscription.service";

/**
 * Phase 3 of the admin-platform plan — real platform performance, built
 * entirely from infra that already exists (see the plan's own Phase 3
 * section for the full "explicitly out of scope" list: no uptime/alerting/
 * log aggregation/APM, since none of that infra exists in this codebase
 * today, and inventing telemetry that isn't real would be worse than not
 * having a dashboard at all).
 */

export interface QueueHealth {
  name: string;
  /** false when REDIS_URL is unset — the same real, disclosed-gate
   * pattern every other Redis-dependent feature in this codebase
   * already uses (see queue.module.ts's own comment), not a bug. */
  configured: boolean;
  waiting?: number;
  active?: number;
  completed?: number;
  failed?: number;
  delayed?: number;
}

export interface DatabaseHealth {
  configured: boolean;
  totalCount?: number;
  idleCount?: number;
  waitingCount?: number;
}

export interface BusinessMetrics {
  tenantCount: number;
  tenantsByTier: Record<string, number>;
  /** Real, computed from TIER_PRICING_ZAR × every tenant currently
   * `active` on a paid tier — not estimated. */
  mrrZar: number;
  /**
   * DISCLOSED LIMITATION: this codebase has no event log of subscription
   * transitions (no "tenant moved from active to past_due on date X"
   * record anywhere) — only the tenant's CURRENT subscriptionStatus is
   * ever stored. A true "churn over the last N days" figure would need
   * that history and doesn't exist yet. This is the honest proxy that
   * genuinely is computable today: tenants currently sitting in
   * past_due are real, current at-risk revenue, not a fabricated rate.
   */
  pastDueTenantCount: number;
  signupsByDay: { date: string; count: number }[];
}

export interface SupportTicketMetrics {
  openCount: number;
  inProgressCount: number;
  resolvedCount: number;
  /** null when no ticket has ever been resolved — never fabricated as 0,
   * which would misleadingly read as "instant resolution." */
  averageResolutionHours: number | null;
}

export interface PlatformHealth {
  generatedAt: Date;
  queues: QueueHealth[];
  database: DatabaseHealth;
  business: BusinessMetrics;
  supportTickets: SupportTicketMetrics;
}

/** The 6 real BullMQ queues in this codebase (see each *-check.service.ts's
 * own producer side) — this service only ever reads their job counts, it
 * never enqueues anything itself. */
const QUEUE_NAMES = [
  NOTIFICATION_QUEUE_NAME,
  CLEANUP_QUEUE_NAME,
  SUBSCRIPTION_BILLING_QUEUE_NAME,
  CRM_STALE_LEAD_QUEUE_NAME,
  QUOTATION_STALE_QUEUE_NAME,
  KPI_BENCHMARK_QUEUE_NAME,
];

const SIGNUP_WINDOW_DAYS = 30;

@Injectable()
export class PlatformHealthService implements OnModuleDestroy {
  /** Same REDIS_URL-gated pattern as queue.module.ts's own NOTIFICATION_QUEUE
   * provider: `[]` when unset, so getQueueHealth() below reports every
   * queue as honestly unconfigured instead of throwing. */
  private readonly queues: Queue[] = process.env.REDIS_URL
    ? QUEUE_NAMES.map((name) => new Queue(name, { connection: { url: process.env.REDIS_URL } }))
    : [];

  constructor(
    @Inject(PG_POOL) private readonly pool: Pool | null,
    private readonly supportTicketAdminService: SupportTicketAdminService
  ) {}

  async onModuleDestroy(): Promise<void> {
    // Same reasoning as QueueModule/DatabaseModule's own onModuleDestroy —
    // without this, Jest (and a real process) leaks these queues' open
    // Redis connections.
    await Promise.all(this.queues.map((q) => q.close()));
  }

  async getPlatformHealth(): Promise<PlatformHealth> {
    const [queues, database, business, supportTickets] = await Promise.all([
      this.getQueueHealth(),
      Promise.resolve(this.getDatabaseHealth()),
      this.getBusinessMetrics(),
      this.getSupportTicketMetrics(),
    ]);
    return { generatedAt: new Date(), queues, database, business, supportTickets };
  }

  private async getQueueHealth(): Promise<QueueHealth[]> {
    if (this.queues.length === 0) {
      return QUEUE_NAMES.map((name) => ({ name, configured: false }));
    }
    return Promise.all(
      this.queues.map(async (queue) => {
        const counts = await queue.getJobCounts("waiting", "active", "completed", "failed", "delayed");
        return {
          name: queue.name,
          configured: true,
          waiting: counts.waiting ?? 0,
          active: counts.active ?? 0,
          completed: counts.completed ?? 0,
          failed: counts.failed ?? 0,
          delayed: counts.delayed ?? 0,
        };
      })
    );
  }

  private getDatabaseHealth(): DatabaseHealth {
    if (!this.pool) return { configured: false };
    return { configured: true, totalCount: this.pool.totalCount, idleCount: this.pool.idleCount, waitingCount: this.pool.waitingCount };
  }

  /**
   * `tenant` carries no RLS (it's the root registry every tenant_id
   * column references — postgres.ts's own comment), same reasoning
   * pilot-summary.service.ts/support-ticket-admin.service.ts already
   * rely on for a direct, un-scoped query here.
   */
  private async getBusinessMetrics(): Promise<BusinessMetrics> {
    if (!this.pool) {
      return { tenantCount: 0, tenantsByTier: {}, mrrZar: 0, pastDueTenantCount: 0, signupsByDay: [] };
    }

    const result = await this.pool.query<{ subscription_tier: string; subscription_status: string; created_at: Date }>(
      "select subscription_tier, subscription_status, created_at from tenant"
    );

    const tenantsByTier: Record<string, number> = {};
    let mrrZar = 0;
    let pastDueTenantCount = 0;
    const signupCountByDay = new Map<string, number>();
    const windowStart = new Date(Date.now() - SIGNUP_WINDOW_DAYS * 24 * 60 * 60 * 1000);

    for (const row of result.rows) {
      tenantsByTier[row.subscription_tier] = (tenantsByTier[row.subscription_tier] ?? 0) + 1;
      if (row.subscription_status === "active" && row.subscription_tier !== "free") {
        mrrZar += TIER_PRICING_ZAR[row.subscription_tier as PaidTier];
      }
      if (row.subscription_status === "past_due") pastDueTenantCount++;
      if (row.created_at >= windowStart) {
        const day = row.created_at.toISOString().slice(0, 10);
        signupCountByDay.set(day, (signupCountByDay.get(day) ?? 0) + 1);
      }
    }

    const signupsByDay = Array.from(signupCountByDay.entries())
      .map(([date, count]) => ({ date, count }))
      .sort((a, b) => a.date.localeCompare(b.date));

    return { tenantCount: result.rows.length, tenantsByTier, mrrZar, pastDueTenantCount, signupsByDay };
  }

  /** Reuses SupportTicketAdminService's existing cross-tenant list rather
   * than querying tickets a second way — same "compute from real existing
   * signals, never duplicate" discipline as AdminTenantService. Resolution
   * time is genuinely real: updatedAt only changes on a status
   * transition, and resolve() is the last transition a ticket can ever
   * make (see support-ticket.service.ts's own status-transition rules),
   * so updatedAt - createdAt for a resolved ticket really is its
   * resolution time, not an approximation. */
  private async getSupportTicketMetrics(): Promise<SupportTicketMetrics> {
    const tickets = await this.supportTicketAdminService.listAcrossTenants();
    const openCount = tickets.filter((t) => t.status === "open").length;
    const inProgressCount = tickets.filter((t) => t.status === "in_progress").length;
    const resolved = tickets.filter((t) => t.status === "resolved");

    const averageResolutionHours =
      resolved.length === 0
        ? null
        : resolved.reduce((sum, t) => sum + (t.updatedAt.getTime() - t.createdAt.getTime()), 0) / resolved.length / (1000 * 60 * 60);

    return { openCount, inProgressCount, resolvedCount: resolved.length, averageResolutionHours };
  }
}

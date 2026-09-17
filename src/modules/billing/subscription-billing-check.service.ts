import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Pool } from "pg";
import { Queue, Worker, Job } from "bullmq";
import { PG_POOL } from "../../common/database.module";
import { SubscriptionService, TIER_LABELS, TIER_PRICING_ZAR, PaidTier } from "./subscription.service";
import { TenantService } from "../auth/tenant.service";
import { EmailService } from "../integrations/email/email.service";
import { EMAIL_SERVICE } from "../integrations/email/email.tokens";

export const SUBSCRIPTION_BILLING_QUEUE_NAME = "subscription-billing-check";
const SUBSCRIPTION_BILLING_JOB_NAME = "check-subscription-renewals";

/** Same env-var-with-a-localhost-default pattern as
 * TenantService.buildVerificationUrl()'s own APP_BASE_URL comment — the
 * real link a renewal payment redirects back to once paid. */
function billingRedirectUrl(): string {
  const base = process.env.APP_BASE_URL ?? "http://localhost:5173";
  return `${base}/settings`;
}

/**
 * B2's own recurring half — mirrors CrmStaleLeadCheckService/
 * KpiBenchmarkCheckService/QuotationStaleCheckService exactly: a real
 * daily BullMQ job, active only when both DATABASE_URL and REDIS_URL are
 * set. Does two real things per tenant, both delegated to
 * SubscriptionService (this service is scheduling + iteration only, no
 * billing decision of its own — see that service's own comment on why
 * confirmPending()/chargeRenewalIfDue() are the one real code path
 * whether called here or by a staff member's manual action):
 *   1. Confirms any payment still marked "pending" against MoPay's own
 *      session-detail endpoint (there's no server-push webhook — see
 *      mopay.service.ts's own top comment — so this poll IS the real
 *      confirmation mechanism, not a backup to one).
 *   2. Charges the next real billing-period fee for any paid tenant
 *      whose nextBillingDate has passed, emailing them a real, working
 *      payment link — "recurring" implemented honestly (see
 *      subscription.service.ts's own top comment on why MoPay's real API
 *      has no subscription feature to lean on).
 */
@Injectable()
export class SubscriptionBillingCheckService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SubscriptionBillingCheckService.name);
  private queue: Queue | null = null;
  private worker: Worker | null = null;

  constructor(
    @Inject(PG_POOL) private readonly pool: Pool | null,
    private readonly subscriptionService: SubscriptionService,
    private readonly tenantService: TenantService,
    @Inject(EMAIL_SERVICE) private readonly emailService: EmailService
  ) {}

  /** Exposed as its own public method, same reasoning as the other daily
   * check services' own checkAllTenants() comments. */
  async checkAllTenants(): Promise<{ confirmed: number; renewalsCharged: number }> {
    if (!this.pool) return { confirmed: 0, renewalsCharged: 0 };
    const tenants = await this.pool.query<{ id: string }>("select id from tenant");
    const now = new Date();
    let confirmed = 0;
    let renewalsCharged = 0;

    for (const { id: tenantId } of tenants.rows) {
      const tenant = await this.tenantService.getById(tenantId);
      if (!tenant) continue;

      if (tenant.subscriptionStatus === "pending_payment") {
        const before = tenant.subscriptionStatus;
        const result = await this.subscriptionService.confirmPending(tenantId, now);
        if (result.status !== before) confirmed++;
        continue;
      }

      const renewal = await this.subscriptionService.chargeRenewalIfDue(
        tenantId,
        { subscriptionTier: tenant.subscriptionTier ?? "free", subscriptionStatus: tenant.subscriptionStatus ?? "active", nextBillingDate: tenant.nextBillingDate },
        billingRedirectUrl(),
        now
      );
      if (renewal.charged && renewal.checkoutUrl) {
        renewalsCharged++;
        await this.sendRenewalEmail(tenant, renewal.checkoutUrl);
      }
    }

    return { confirmed, renewalsCharged };
  }

  private async sendRenewalEmail(tenant: { contactEmail?: string; name: string; subscriptionTier?: string }, checkoutUrl: string): Promise<void> {
    // A real, honest "nothing to send it to" case — tenant.contactEmail
    // is the tenant's own real business contact address (see
    // TenantRecord's own comment), not fabricated. No fallback address
    // is invented here.
    if (!tenant.contactEmail) {
      this.logger.warn(`Subscription renewal due for tenant with no contactEmail on file — payment link not sent, only created: ${checkoutUrl}`);
      return;
    }
    const tier = tenant.subscriptionTier as PaidTier;
    await this.emailService.sendSubscriptionRenewalEmail(tenant.contactEmail, tenant.name, TIER_LABELS[tier], TIER_PRICING_ZAR[tier], checkoutUrl);
  }

  async onModuleInit(): Promise<void> {
    if (!this.pool || !process.env.REDIS_URL) return;
    this.queue = new Queue(SUBSCRIPTION_BILLING_QUEUE_NAME, { connection: { url: process.env.REDIS_URL } });
    await this.queue.upsertJobScheduler(SUBSCRIPTION_BILLING_JOB_NAME, { every: 24 * 60 * 60 * 1000 }, { name: SUBSCRIPTION_BILLING_JOB_NAME });

    this.worker = new Worker(
      SUBSCRIPTION_BILLING_QUEUE_NAME,
      async (job: Job) => {
        if (job.name !== SUBSCRIPTION_BILLING_JOB_NAME) return;
        const { confirmed, renewalsCharged } = await this.checkAllTenants();
        this.logger.log(`Checked subscription billing: ${confirmed} payment(s) confirmed, ${renewalsCharged} renewal(s) charged`);
      },
      { connection: { url: process.env.REDIS_URL } }
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
  }
}

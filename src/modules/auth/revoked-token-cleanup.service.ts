import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Pool } from "pg";
import { Queue, Worker, Job } from "bullmq";
import { PG_POOL } from "../../common/database.module";
import { runWithTenantContext } from "../../common/postgres";

const CLEANUP_QUEUE_NAME = "maintenance";
const CLEANUP_JOB_NAME = "delete-expired-revoked-tokens";

/**
 * Closes the KNOWN GAP db/migrations/0004_refresh_token_revocation.sql has
 * flagged since it was first written: nothing deleted a `revoked_refresh_token`
 * row once its `expires_at` passed, so the table would grow forever at real
 * volume, holding rows that can no longer possibly matter (an expired JWT
 * already fails verification before this table is ever consulted). Now that
 * BullMQ is a real, live-verified dependency (see NotificationWorkerService),
 * that same infrastructure can run this as a genuine scheduled job instead of
 * leaving it as a documented-but-unbuilt TODO.
 *
 * Same double-gated pattern as everything else: does nothing at all unless
 * BOTH a real Postgres pool (DATABASE_URL) and a real Redis-compatible queue
 * (REDIS_URL) exist — there is nothing to clean up in-memory (the in-memory
 * store never grows past process lifetime anyway) and no scheduler without
 * Redis.
 */
@Injectable()
export class RevokedTokenCleanupService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RevokedTokenCleanupService.name);
  private queue: Queue | null = null;
  private worker: Worker | null = null;

  constructor(@Inject(PG_POOL) private readonly pool: Pool | null) {}

  /**
   * The actual DELETE, exposed as its own public method (not just buried
   * inside the worker's processor callback) specifically so a test can call
   * it directly against a real database without needing a real Redis round
   * trip too — the SQL correctness and the scheduling mechanism are two
   * separately-verifiable claims, same reasoning as everywhere else in this
   * codebase that keeps persistence and wiring as separate proofs.
   *
   * Iterates per-tenant via runWithTenantContext rather than one plain
   * cross-tenant DELETE — found the hard way why a plain query doesn't
   * work here: `revoked_refresh_token` has RLS, and a pooled connection
   * that has EVER run a transaction-scoped set_config() reverts, after
   * COMMIT, to an EMPTY STRING for that setting, not NULL (confirmed
   * directly against this database — see postgres.ts's own comment for the
   * full explanation). RLS's policy then evaluates ''::uuid and throws,
   * rather than the harmless "sees nothing" a genuinely-NULL setting would
   * produce. Listing tenants first is safe: `tenant` itself carries no RLS
   * policy (it's the root table every tenant_id column references), and at
   * Master Plan Section 2's own pilot scale (5–10 tenants) looping per
   * tenant for a once-a-day maintenance job is exactly the right-sized
   * approach, not a performance concern to solve prematurely.
   */
  async deleteExpired(): Promise<number> {
    if (!this.pool) return 0;
    const tenants = await this.pool.query<{ id: string }>("select id from tenant");
    let totalDeleted = 0;
    for (const { id: tenantId } of tenants.rows) {
      const result = await runWithTenantContext(this.pool, tenantId, (client) =>
        client.query("delete from revoked_refresh_token where expires_at < now()")
      );
      totalDeleted += result.rowCount ?? 0;
    }
    return totalDeleted;
  }

  async onModuleInit(): Promise<void> {
    if (!this.pool || !process.env.REDIS_URL) return;
    this.queue = new Queue(CLEANUP_QUEUE_NAME, { connection: { url: process.env.REDIS_URL } });
    // upsertJobScheduler, not add(..., {repeat}) — BullMQ v6 moved
    // repeatable-job scheduling to its own API (found only by actually
    // running `tsc`: the old `{repeat: {...}}` option on add() no longer
    // exists on JobsOptions). "upsert" makes this idempotent across
    // restarts — calling it again with the same scheduler id updates the
    // existing schedule rather than creating a duplicate one, so restarting
    // the app repeatedly doesn't pile up duplicate schedules.
    await this.queue.upsertJobScheduler(CLEANUP_JOB_NAME, { every: 24 * 60 * 60 * 1000 }, { name: CLEANUP_JOB_NAME });

    this.worker = new Worker(
      CLEANUP_QUEUE_NAME,
      async (job: Job) => {
        if (job.name !== CLEANUP_JOB_NAME) return;
        const deleted = await this.deleteExpired();
        this.logger.log(`Deleted ${deleted} expired revoked_refresh_token row(s)`);
      },
      { connection: { url: process.env.REDIS_URL } }
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
  }
}

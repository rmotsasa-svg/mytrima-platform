import { Global, Inject, Module, OnModuleDestroy } from "@nestjs/common";
import { Pool } from "pg";

export const PG_POOL = Symbol("PG_POOL");

/**
 * Global module providing a single shared Postgres connection pool — every
 * Pg*Store across the app (Consent, Rating, Auth) injects the same PG_POOL
 * rather than each opening its own pool to the same database. @Global()
 * means every feature module can inject PG_POOL without listing
 * DatabaseModule in its own `imports` array — only AppModule needs to.
 *
 * When DATABASE_URL is unset, provides `null` — each feature module's own
 * provider factory falls back to its InMemory* store in that case, so the
 * app boots and the dashboard works exactly as before with zero
 * configuration, and switches to real persistence the moment DATABASE_URL
 * is set.
 *
 * Closes the pool on module destroy — caught by actually running
 * app.module.test.ts against a real database: without this, Jest reported
 * "did not exit one second after the test run completed," a real open-
 * handle leak (the pool's TCP connections to Postgres are never released),
 * not just cosmetic test-runner noise.
 */
@Global()
@Module({
  providers: [
    {
      provide: PG_POOL,
      useFactory: (): Pool | null => (process.env.DATABASE_URL ? new Pool({ connectionString: process.env.DATABASE_URL }) : null),
    },
  ],
  exports: [PG_POOL],
})
export class DatabaseModule implements OnModuleDestroy {
  constructor(@Inject(PG_POOL) private readonly pool: Pool | null) {}

  async onModuleDestroy(): Promise<void> {
    await this.pool?.end();
  }
}

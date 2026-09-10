import { Module } from "@nestjs/common";
import { Pool } from "pg";
import { PaymentsController } from "./payments.controller";
import { PayfastItnLogService, PayfastItnLogStore } from "./payfast-itn-log.service";
import { InMemoryPayfastItnLogStore } from "./in-memory-payfast-itn-log.store";
import { PgPayfastItnLogStore } from "./pg-payfast-itn-log.store";
import { PAYFAST_ITN_LOG_STORE, PAYFAST_MERCHANT_ID, PAYFAST_MERCHANT_KEY, PAYFAST_PASSPHRASE, PAYFAST_SANDBOX } from "./payments.tokens";
import { PG_POOL } from "../../common/database.module";
import { AuthModule } from "../auth/auth.module";
import { AccessTokenGuard } from "../auth/access-token.guard";

/**
 * No dev-only fallback for the PayFast credentials, same reasoning as
 * SocialPublishingModule's META_APP_ID/META_APP_SECRET: a fake merchant
 * id/key doesn't let checkout "work insecurely," it just fails outright
 * against the real PayFast gateway — no equivalent footgun to guard
 * against by inventing a default. PAYFAST_SANDBOX defaults to true (not
 * false) — the safer failure mode for an unset env var is "accidentally
 * still testing," not "accidentally live with a real customer's card."
 */
@Module({
  imports: [AuthModule],
  controllers: [PaymentsController],
  providers: [
    PayfastItnLogService,
    // AccessTokenGuard re-declared here on purpose — see auth.module.ts's
    // own "REAL BUG found 2026-09-10" comment: `@UseGuards(ClassRef)`
    // resolves the guard via the CONSUMING module's own injector, and
    // exporting it from AuthModule alone isn't sufficient for that specific
    // resolution path (unlike a plain constructor-injected provider like
    // TenantService, which resolves correctly through the export/import
    // chain without this). This reuses the same underlying AuthService
    // singleton (exported above) — not a second, divergent auth system.
    AccessTokenGuard,
    {
      provide: PAYFAST_ITN_LOG_STORE,
      inject: [PG_POOL],
      useFactory: (pool: Pool | null): PayfastItnLogStore => (pool ? new PgPayfastItnLogStore(pool) : new InMemoryPayfastItnLogStore()),
    },
    { provide: PAYFAST_MERCHANT_ID, useValue: process.env.PAYFAST_MERCHANT_ID ?? "" },
    { provide: PAYFAST_MERCHANT_KEY, useValue: process.env.PAYFAST_MERCHANT_KEY ?? "" },
    { provide: PAYFAST_PASSPHRASE, useValue: process.env.PAYFAST_PASSPHRASE ?? "" },
    { provide: PAYFAST_SANDBOX, useValue: process.env.PAYFAST_SANDBOX !== "false" },
  ],
})
export class PaymentsModule {}

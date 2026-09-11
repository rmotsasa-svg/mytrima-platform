import { Module } from "@nestjs/common";
import { Pool } from "pg";
import { ConsentController } from "./consent.controller";
import { ConsentService, ConsentStore } from "./consent.service";
import { InMemoryConsentStore } from "./in-memory-consent.store";
import { PgConsentStore } from "./pg-consent.store";
import { CONSENT_STORE } from "./consent.tokens";
import { PG_POOL } from "../../common/database.module";
import { AuthModule } from "../auth/auth.module";
import { AccessTokenGuard } from "../auth/access-token.guard";

@Module({
  imports: [AuthModule],
  controllers: [ConsentController],
  providers: [
    ConsentService,
    // Re-declared locally — see SalesModule's own comment.
    AccessTokenGuard,
    {
      provide: CONSENT_STORE,
      inject: [PG_POOL],
      useFactory: (pool: Pool | null): ConsentStore => (pool ? new PgConsentStore(pool) : new InMemoryConsentStore()),
    },
  ],
  // Exported so CustomerModule can build a customer activity view aggregating
  // consent records for a given customerId (see CustomerService.getActivity()).
  exports: [ConsentService],
})
export class ConsentModule {}

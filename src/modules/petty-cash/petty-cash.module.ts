import { Module } from "@nestjs/common";
import { Pool } from "pg";
import { VendorController, PettyCashController } from "./petty-cash.controller";
import { VendorService, VendorStore } from "./vendor.service";
import { PettyCashService, PettyCashStore } from "./petty-cash.service";
import { InMemoryVendorStore } from "./in-memory-vendor.store";
import { PgVendorStore } from "./pg-vendor.store";
import { InMemoryPettyCashStore } from "./in-memory-petty-cash.store";
import { PgPettyCashStore } from "./pg-petty-cash.store";
import { VENDOR_STORE, PETTY_CASH_STORE } from "./petty-cash.tokens";
import { PG_POOL } from "../../common/database.module";
import { AuthModule } from "../auth/auth.module";
import { AccessTokenGuard } from "../auth/access-token.guard";

@Module({
  imports: [AuthModule],
  controllers: [VendorController, PettyCashController],
  providers: [
    VendorService,
    PettyCashService,
    // Re-declared locally — see SalesModule's own comment.
    AccessTokenGuard,
    {
      provide: VENDOR_STORE,
      inject: [PG_POOL],
      useFactory: (pool: Pool | null): VendorStore => (pool ? new PgVendorStore(pool) : new InMemoryVendorStore()),
    },
    {
      provide: PETTY_CASH_STORE,
      inject: [PG_POOL],
      useFactory: (pool: Pool | null): PettyCashStore => (pool ? new PgPettyCashStore(pool) : new InMemoryPettyCashStore()),
    },
  ],
  exports: [VendorService, PettyCashService],
})
export class PettyCashModule {}

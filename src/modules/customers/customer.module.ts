import { Module } from "@nestjs/common";
import { Pool } from "pg";
import { CustomerController } from "./customer.controller";
import { CustomerService, CustomerStore } from "./customer.service";
import { InMemoryCustomerStore } from "./in-memory-customer.store";
import { PgCustomerStore } from "./pg-customer.store";
import { CUSTOMER_STORE } from "./customer.tokens";
import { PG_POOL } from "../../common/database.module";
import { RatingModule } from "../reputation/rating.module";
import { ConsentModule } from "../compliance/consent.module";
import { AuthModule } from "../auth/auth.module";
import { AccessTokenGuard } from "../auth/access-token.guard";

@Module({
  // RatingModule/ConsentModule imported so CustomerService can inject their
  // real services and build a "customer activity" view from data that
  // already exists elsewhere — see CustomerService.getActivity().
  imports: [RatingModule, ConsentModule, AuthModule],
  controllers: [CustomerController],
  providers: [
    CustomerService,
    // Re-declared locally — see SalesModule's own comment.
    AccessTokenGuard,
    {
      provide: CUSTOMER_STORE,
      inject: [PG_POOL],
      useFactory: (pool: Pool | null): CustomerStore => (pool ? new PgCustomerStore(pool) : new InMemoryCustomerStore()),
    },
  ],
  // Exported 2026-09-10 so OnboardingModule can inject the real
  // CustomerService directly (checking "has this tenant added a first
  // customer yet") — same real gap already found and fixed on AuthModule
  // (see auth.module.ts's own "REAL BUG found 2026-09-10" comment): a
  // module's own providers aren't visible to another module that merely
  // imports it, without an explicit export.
  exports: [CustomerService],
})
export class CustomerModule {}

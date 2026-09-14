import { Module, forwardRef } from "@nestjs/common";
import { Pool } from "pg";
import { CustomerController } from "./customer.controller";
import { CustomerService, CustomerStore } from "./customer.service";
import { InMemoryCustomerStore } from "./in-memory-customer.store";
import { PgCustomerStore } from "./pg-customer.store";
import { CUSTOMER_STORE } from "./customer.tokens";
import { PG_POOL } from "../../common/database.module";
import { RatingModule } from "../reputation/rating.module";
import { ConsentModule } from "../compliance/consent.module";
import { SalesModule } from "../sales/sales.module";
import { BookingModule } from "../booking/booking.module";
import { AuthModule } from "../auth/auth.module";
import { AccessTokenGuard } from "../auth/access-token.guard";

@Module({
  // RatingModule/ConsentModule imported so CustomerService can inject their
  // real services and build a "customer activity" view from data that
  // already exists elsewhere — see CustomerService.getActivity(). SalesModule
  // and BookingModule added 2026-09-14 so CustomerController.activity() can
  // fold in a customer's real sales/booking history the same way — done at
  // the CONTROLLER, not the CustomerService, level: BookingService already
  // depends on CustomerService to validate a booking's customerId, so a
  // CustomerService -> BookingService dependency would be a genuine
  // construction-time cycle (not just a module-graph one), impossible to
  // build in a plain unit test that hand-constructs each service. The
  // module-graph cycle this still creates (BookingModule already imports
  // CustomerModule) is resolved with forwardRef() on both sides — see
  // booking.module.ts's own matching comment. SalesModule has no such
  // cycle (SaleService never depends on CustomerService), so it's a plain
  // import.
  imports: [RatingModule, ConsentModule, SalesModule, forwardRef(() => BookingModule), AuthModule],
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

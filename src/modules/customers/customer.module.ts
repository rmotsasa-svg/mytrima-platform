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

@Module({
  // RatingModule/ConsentModule imported so CustomerService can inject their
  // real services and build a "customer activity" view from data that
  // already exists elsewhere — see CustomerService.getActivity().
  imports: [RatingModule, ConsentModule],
  controllers: [CustomerController],
  providers: [
    CustomerService,
    {
      provide: CUSTOMER_STORE,
      inject: [PG_POOL],
      useFactory: (pool: Pool | null): CustomerStore => (pool ? new PgCustomerStore(pool) : new InMemoryCustomerStore()),
    },
  ],
})
export class CustomerModule {}

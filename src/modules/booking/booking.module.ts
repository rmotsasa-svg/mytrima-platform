import { Module } from "@nestjs/common";
import { Pool } from "pg";
import { BookingController } from "./booking.controller";
import { BookingService, BookingStore } from "./booking.service";
import { InMemoryBookingStore } from "./in-memory-booking.store";
import { PgBookingStore } from "./pg-booking.store";
import { BOOKING_STORE } from "./booking.tokens";
import { PG_POOL } from "../../common/database.module";
import { CatalogModule } from "../catalog/catalog.module";
import { CustomerModule } from "../customers/customer.module";
import { AutomationModule } from "../automation/automation.module";
import { AuthModule } from "../auth/auth.module";
import { AccessTokenGuard } from "../auth/access-token.guard";

@Module({
  imports: [CatalogModule, CustomerModule, AutomationModule, AuthModule],
  controllers: [BookingController],
  providers: [
    BookingService,
    // Re-declared locally — see SalesModule's own comment.
    AccessTokenGuard,
    {
      provide: BOOKING_STORE,
      inject: [PG_POOL],
      useFactory: (pool: Pool | null): BookingStore => (pool ? new PgBookingStore(pool) : new InMemoryBookingStore()),
    },
  ],
  exports: [BookingService],
})
export class BookingModule {}

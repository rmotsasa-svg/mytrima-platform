import { Module } from "@nestjs/common";
import { Pool } from "pg";
import { SupportTicketController } from "./support-ticket.controller";
import { SupportTicketService, SupportTicketStore } from "./support-ticket.service";
import { InMemorySupportTicketStore } from "./in-memory-support-ticket.store";
import { PgSupportTicketStore } from "./pg-support-ticket.store";
import { SUPPORT_TICKET_STORE } from "./support-ticket.tokens";
import { PG_POOL } from "../../common/database.module";
import { AuthModule } from "../auth/auth.module";
import { AccessTokenGuard } from "../auth/access-token.guard";

@Module({
  imports: [AuthModule],
  controllers: [SupportTicketController],
  providers: [
    SupportTicketService,
    // Re-declared locally even though AuthModule already exports it — a
    // guard referenced by class in @UseGuards() is resolved through the
    // CONSUMING module's own injector and does not automatically pick up a
    // same-class export from an imported module. Same real gap found and
    // fixed on PaymentsModule (see that module's own comment).
    AccessTokenGuard,
    {
      provide: SUPPORT_TICKET_STORE,
      inject: [PG_POOL],
      useFactory: (pool: Pool | null): SupportTicketStore => (pool ? new PgSupportTicketStore(pool) : new InMemorySupportTicketStore()),
    },
  ],
  // Exported so AdminModule's SupportTicketAdminService can reuse the same
  // real, already-tested SupportTicketService.listForTenant()/resolve()/
  // markInProgress() rather than duplicating that logic against the store
  // directly — same "one source of truth" reasoning as every other
  // cross-module export in this codebase.
  exports: [SupportTicketService],
})
export class SupportTicketModule {}

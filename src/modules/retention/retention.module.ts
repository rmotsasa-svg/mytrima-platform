import { Module } from "@nestjs/common";
import { RetentionController } from "./retention.controller";
import { RetentionService } from "./retention.service";
import { SalesModule } from "../sales/sales.module";
import { CustomerModule } from "../customers/customer.module";
import { AuthModule } from "../auth/auth.module";
import { AccessTokenGuard } from "../auth/access-token.guard";

/** No store, no token, no migration — see retention.service.ts's own top
 * comment on why this phase is deliberately read-only. Imports both
 * SalesModule and CustomerModule directly; no forwardRef needed, since
 * neither imports this new module back. */
@Module({
  imports: [SalesModule, CustomerModule, AuthModule],
  controllers: [RetentionController],
  providers: [
    RetentionService,
    // Re-declared locally — see SalesModule's own comment.
    AccessTokenGuard,
  ],
})
export class RetentionModule {}

import { Module } from "@nestjs/common";
import { Pool } from "pg";
import { AuditLogService, AuditLogStore } from "./audit-log.service";
import { InMemoryAuditLogStore } from "./in-memory-audit-log.store";
import { PgAuditLogStore } from "./pg-audit-log.store";
import { AUDIT_LOG_STORE } from "./audit-log.tokens";
import { PG_POOL } from "../../common/database.module";

@Module({
  providers: [
    AuditLogService,
    {
      provide: AUDIT_LOG_STORE,
      inject: [PG_POOL],
      useFactory: (pool: Pool | null): AuditLogStore => (pool ? new PgAuditLogStore(pool) : new InMemoryAuditLogStore()),
    },
  ],
  exports: [AuditLogService],
})
export class AuditLogModule {}

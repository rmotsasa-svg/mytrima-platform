import { Module } from "@nestjs/common";
import { Pool } from "pg";
import { NpsController } from "./nps.controller";
import { NpsService, NpsResponseStore } from "./nps.service";
import { InMemoryNpsResponseStore } from "./in-memory-nps-response.store";
import { PgNpsResponseStore } from "./pg-nps-response.store";
import { NPS_RESPONSE_STORE } from "./nps.tokens";
import { PG_POOL } from "../../common/database.module";
import { AutomationModule } from "../automation/automation.module";

@Module({
  imports: [AutomationModule],
  controllers: [NpsController],
  providers: [
    NpsService,
    {
      provide: NPS_RESPONSE_STORE,
      inject: [PG_POOL],
      useFactory: (pool: Pool | null): NpsResponseStore => (pool ? new PgNpsResponseStore(pool) : new InMemoryNpsResponseStore()),
    },
  ],
})
export class NpsModule {}

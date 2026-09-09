import { Module } from "@nestjs/common";
import { Pool } from "pg";
import { CatalogController } from "./catalog.controller";
import { CatalogService, CatalogItemStore } from "./catalog-item.service";
import { InMemoryCatalogItemStore } from "./in-memory-catalog-item.store";
import { PgCatalogItemStore } from "./pg-catalog-item.store";
import { CATALOG_ITEM_STORE } from "./catalog.tokens";
import { PG_POOL } from "../../common/database.module";

@Module({
  controllers: [CatalogController],
  providers: [
    CatalogService,
    {
      provide: CATALOG_ITEM_STORE,
      inject: [PG_POOL],
      useFactory: (pool: Pool | null): CatalogItemStore => (pool ? new PgCatalogItemStore(pool) : new InMemoryCatalogItemStore()),
    },
  ],
  exports: [CatalogService],
})
export class CatalogModule {}

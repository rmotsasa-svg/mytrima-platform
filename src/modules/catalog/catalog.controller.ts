import { Body, Controller, Get, NotFoundException, Param, Patch, Post } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { CatalogService, ItemType } from "./catalog-item.service";

interface CreateCatalogItemBody {
  name: string;
  itemType: ItemType;
  unitPrice: number;
  sku?: string;
}

interface UpdateCatalogItemBody {
  name?: string;
  unitPrice?: number;
  isActive?: boolean;
  sku?: string;
}

@Controller("catalog")
export class CatalogController {
  constructor(private readonly catalogService: CatalogService) {}

  @Post(":tenantId")
  create(@Param("tenantId") tenantId: string, @Body() body: CreateCatalogItemBody) {
    return this.catalogService.create(tenantId, randomUUID(), body.name, body.itemType, body.unitPrice, body.sku);
  }

  @Get(":tenantId")
  list(@Param("tenantId") tenantId: string) {
    return this.catalogService.listForTenant(tenantId);
  }

  @Get(":tenantId/:itemId")
  async getOne(@Param("tenantId") tenantId: string, @Param("itemId") itemId: string) {
    const item = await this.catalogService.findById(tenantId, itemId);
    if (!item) throw new NotFoundException(`No catalog item found with id "${itemId}"`);
    return item;
  }

  @Patch(":tenantId/:itemId")
  update(@Param("tenantId") tenantId: string, @Param("itemId") itemId: string, @Body() body: UpdateCatalogItemBody) {
    return this.catalogService.update(tenantId, itemId, body.name, body.unitPrice, body.isActive, body.sku);
  }
}

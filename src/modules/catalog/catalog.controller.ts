import { Body, Controller, Get, NotFoundException, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { CatalogService, ItemType } from "./catalog-item.service";
import { AccessTokenGuard } from "../auth/access-token.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import { VerifiedAccessToken } from "../auth/auth.service";
import { authorize } from "../auth/rbac";

interface CreateCatalogItemBody {
  name: string;
  itemType: ItemType;
  unitPrice: number;
  sku?: string;
  durationMinutes?: number;
}

interface UpdateCatalogItemBody {
  name?: string;
  unitPrice?: number;
  isActive?: boolean;
  sku?: string;
  durationMinutes?: number;
}

/** Gated 2026-09-11 — closes the real gap the Platform Readiness Assessment
 * flagged: this controller had no auth guard at all. `catalog:view` for
 * reads, `catalog:manage` for writes. */
@UseGuards(AccessTokenGuard)
@Controller("catalog")
export class CatalogController {
  constructor(private readonly catalogService: CatalogService) {}

  @Post(":tenantId")
  create(@CurrentUser() actor: VerifiedAccessToken, @Param("tenantId") tenantId: string, @Body() body: CreateCatalogItemBody) {
    authorize(actor, tenantId, "catalog:manage");
    return this.catalogService.create(tenantId, randomUUID(), body.name, body.itemType, body.unitPrice, body.sku, body.durationMinutes);
  }

  @Get(":tenantId")
  list(@CurrentUser() actor: VerifiedAccessToken, @Param("tenantId") tenantId: string) {
    authorize(actor, tenantId, "catalog:view");
    return this.catalogService.listForTenant(tenantId);
  }

  @Get(":tenantId/:itemId")
  async getOne(@CurrentUser() actor: VerifiedAccessToken, @Param("tenantId") tenantId: string, @Param("itemId") itemId: string) {
    authorize(actor, tenantId, "catalog:view");
    const item = await this.catalogService.findById(tenantId, itemId);
    if (!item) throw new NotFoundException(`No catalog item found with id "${itemId}"`);
    return item;
  }

  @Patch(":tenantId/:itemId")
  update(
    @CurrentUser() actor: VerifiedAccessToken,
    @Param("tenantId") tenantId: string,
    @Param("itemId") itemId: string,
    @Body() body: UpdateCatalogItemBody
  ) {
    authorize(actor, tenantId, "catalog:manage");
    return this.catalogService.update(tenantId, itemId, body.name, body.unitPrice, body.isActive, body.sku, body.durationMinutes);
  }
}

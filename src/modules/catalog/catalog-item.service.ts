import { Inject, Injectable } from "@nestjs/common";
import { CATALOG_ITEM_STORE } from "./catalog.tokens";

/**
 * Master Plan Addendum v1.3, Section D: a tenant's own maintained list of
 * what it sells — the prerequisite both the Deals module and the Sales
 * module are built on. Deliberately minimal: no stock/quantity-on-hand
 * tracking, per the addendum's own "no invented capabilities" scoping.
 */

export type ItemType = "product" | "service";

export interface CatalogItem {
  id: string;
  tenantId: string;
  name: string;
  itemType: ItemType;
  sku?: string;
  unitPrice: number;
  /** Added 2026-09-10 for the new Booking module — the default appointment
   * length for a `service` item, in minutes. Nullable and meaningful only
   * for services: a `product` has no duration, and even a service can be
   * created without one (a caller must then supply an explicit duration on
   * each booking — see booking.service.ts's own comment on why this isn't
   * defaulted to a guessed number like 60). */
  durationMinutes?: number;
  isActive: boolean;
  createdAt: Date;
}

export class InvalidCatalogItemError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidCatalogItemError";
  }
}

export class CatalogItemNotFoundError extends Error {
  constructor(id: string) {
    super(`No catalog item found with id "${id}"`);
    this.name = "CatalogItemNotFoundError";
  }
}

export interface CatalogItemStore {
  save(item: CatalogItem): Promise<void>;
  findAllForTenant(tenantId: string): Promise<CatalogItem[]>;
  findById(tenantId: string, id: string): Promise<CatalogItem | null>;
}

function validate(name: string, itemType: string, unitPrice: number, durationMinutes?: number): void {
  if (!name.trim()) throw new InvalidCatalogItemError("name is required");
  if (itemType !== "product" && itemType !== "service") {
    throw new InvalidCatalogItemError('itemType must be "product" or "service"');
  }
  if (!Number.isFinite(unitPrice) || unitPrice < 0) {
    throw new InvalidCatalogItemError("unitPrice must be a non-negative number");
  }
  if (durationMinutes !== undefined && (!Number.isFinite(durationMinutes) || durationMinutes <= 0)) {
    throw new InvalidCatalogItemError("durationMinutes must be a positive number");
  }
}

@Injectable()
export class CatalogService {
  constructor(@Inject(CATALOG_ITEM_STORE) private readonly store: CatalogItemStore) {}

  async create(
    tenantId: string,
    id: string,
    name: string,
    itemType: ItemType,
    unitPrice: number,
    sku?: string,
    durationMinutes?: number
  ): Promise<CatalogItem> {
    validate(name, itemType, unitPrice, durationMinutes);
    const item: CatalogItem = {
      id,
      tenantId,
      name: name.trim(),
      itemType,
      unitPrice,
      sku: sku?.trim() || undefined,
      durationMinutes,
      isActive: true,
      createdAt: new Date(),
    };
    await this.store.save(item);
    return item;
  }

  async listForTenant(tenantId: string): Promise<CatalogItem[]> {
    return this.store.findAllForTenant(tenantId);
  }

  async findById(tenantId: string, id: string): Promise<CatalogItem | null> {
    return this.store.findById(tenantId, id);
  }

  /** Partial update — same "field left out keeps its value" semantics as
   * CustomerService.update(), for the same reason: a caller updating just the
   * price shouldn't need to resend the name too. */
  async update(
    tenantId: string,
    id: string,
    name?: string,
    unitPrice?: number,
    isActive?: boolean,
    sku?: string,
    durationMinutes?: number
  ): Promise<CatalogItem> {
    const existing = await this.store.findById(tenantId, id);
    if (!existing) throw new CatalogItemNotFoundError(id);
    const updated: CatalogItem = {
      ...existing,
      name: name !== undefined ? name.trim() : existing.name,
      unitPrice: unitPrice !== undefined ? unitPrice : existing.unitPrice,
      isActive: isActive !== undefined ? isActive : existing.isActive,
      sku: sku !== undefined ? sku.trim() || undefined : existing.sku,
      durationMinutes: durationMinutes !== undefined ? durationMinutes : existing.durationMinutes,
    };
    validate(updated.name, updated.itemType, updated.unitPrice, updated.durationMinutes);
    await this.store.save(updated);
    return updated;
  }
}

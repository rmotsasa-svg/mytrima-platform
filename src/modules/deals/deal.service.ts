import { Inject, Injectable } from "@nestjs/common";
import { DEAL_STORE } from "./deals.tokens";
import { CatalogService } from "../catalog/catalog-item.service";

/**
 * Master Plan Addendum v1.3, Section F: a standalone offer catalog that a
 * sale transaction (../sales) can optionally apply — listable and
 * manageable on its own (e.g. for WhatsApp/marketing display) whether or
 * not any sale has ever used it. One generalized discount_type model rather
 * than a separate table per promotion pattern.
 */

export type DiscountType = "percentage_off" | "buy_x_get_y_free" | "fixed_amount_off";

export interface Deal {
  id: string;
  tenantId: string;
  name: string;
  discountType: DiscountType;
  percentageOff?: number;
  buyQuantity?: number;
  freeQuantity?: number;
  fixedAmountOff?: number;
  startsAt?: Date;
  endsAt?: Date;
  isActive: boolean;
  catalogItemIds: string[];
  /** A real uploaded ad/promotional creative — see common/uploads.ts's own
   * comment (2026-09-12, tenant's own explicit choice of local-disk
   * storage). Set only via DealsController's own image-upload endpoint. */
  adImageUrl?: string;
  createdAt: Date;
}

export class InvalidDealError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidDealError";
  }
}

export class DealNotFoundError extends Error {
  constructor(id: string) {
    super(`No deal found with id "${id}"`);
    this.name = "DealNotFoundError";
  }
}

export interface DealStore {
  save(deal: Deal): Promise<void>;
  findAllForTenant(tenantId: string): Promise<Deal[]>;
  findById(tenantId: string, id: string): Promise<Deal | null>;
}

function validateDiscount(discountType: DiscountType, percentageOff?: number, buyQuantity?: number, freeQuantity?: number, fixedAmountOff?: number): void {
  if (discountType === "percentage_off") {
    if (!percentageOff || percentageOff <= 0 || percentageOff > 100) throw new InvalidDealError("percentageOff must be between 0 and 100");
  } else if (discountType === "buy_x_get_y_free") {
    if (!buyQuantity || buyQuantity <= 0) throw new InvalidDealError("buyQuantity must be a positive integer");
    if (!freeQuantity || freeQuantity <= 0) throw new InvalidDealError("freeQuantity must be a positive integer");
  } else if (discountType === "fixed_amount_off") {
    if (fixedAmountOff === undefined || fixedAmountOff < 0) throw new InvalidDealError("fixedAmountOff must be a non-negative number");
  }
}

export interface CreateDealInput {
  name: string;
  discountType: DiscountType;
  catalogItemIds: string[];
  percentageOff?: number;
  buyQuantity?: number;
  freeQuantity?: number;
  fixedAmountOff?: number;
  startsAt?: Date;
  endsAt?: Date;
}

@Injectable()
export class DealService {
  constructor(
    @Inject(DEAL_STORE) private readonly store: DealStore,
    private readonly catalogService: CatalogService
  ) {}

  async create(tenantId: string, id: string, input: CreateDealInput): Promise<Deal> {
    if (!input.name.trim()) throw new InvalidDealError("name is required");
    if (input.catalogItemIds.length === 0) throw new InvalidDealError("a deal must apply to at least one catalog item");
    validateDiscount(input.discountType, input.percentageOff, input.buyQuantity, input.freeQuantity, input.fixedAmountOff);

    for (const catalogItemId of input.catalogItemIds) {
      const item = await this.catalogService.findById(tenantId, catalogItemId);
      if (!item) throw new InvalidDealError(`No catalog item found with id "${catalogItemId}" for this tenant`);
    }

    const deal: Deal = {
      id,
      tenantId,
      name: input.name.trim(),
      discountType: input.discountType,
      percentageOff: input.percentageOff,
      buyQuantity: input.buyQuantity,
      freeQuantity: input.freeQuantity,
      fixedAmountOff: input.fixedAmountOff,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      isActive: true,
      catalogItemIds: input.catalogItemIds,
      createdAt: new Date(),
    };
    await this.store.save(deal);
    return deal;
  }

  async listForTenant(tenantId: string): Promise<Deal[]> {
    return this.store.findAllForTenant(tenantId);
  }

  async findById(tenantId: string, id: string): Promise<Deal | null> {
    return this.store.findById(tenantId, id);
  }

  /** See Deal.adImageUrl's own comment — DealsController's image-upload
   * endpoint is the only real caller. */
  async setAdImage(tenantId: string, id: string, adImageUrl: string): Promise<Deal> {
    const existing = await this.store.findById(tenantId, id);
    if (!existing) throw new DealNotFoundError(id);
    const updated: Deal = { ...existing, adImageUrl };
    await this.store.save(updated);
    return updated;
  }

  /**
   * Computes the discount a deal produces against a given subtotal/quantity,
   * for the Sales module to apply at the point of sale. Pure function, no
   * persistence — same "compute, don't store the derived value" discipline
   * as PettyCashService.getBalance().
   */
  computeDiscount(deal: Deal, quantity: number, lineSubtotal: number, unitPrice: number): number {
    if (deal.discountType === "percentage_off") {
      return Math.round(((lineSubtotal * (deal.percentageOff ?? 0)) / 100) * 100) / 100;
    }
    if (deal.discountType === "buy_x_get_y_free") {
      const groupSize = (deal.buyQuantity ?? 0) + (deal.freeQuantity ?? 0);
      if (groupSize <= 0) return 0;
      const freeUnits = Math.floor(quantity / groupSize) * (deal.freeQuantity ?? 0);
      return Math.round(freeUnits * unitPrice * 100) / 100;
    }
    // fixed_amount_off
    return Math.min(deal.fixedAmountOff ?? 0, lineSubtotal);
  }
}

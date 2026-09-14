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
  /** Real push-to-channels history — see migration 0029's own comment.
   * Set only via DealsController's own publish endpoint, never directly. */
  lastPublishedAt?: Date;
  publishedChannels?: SocialChannel[];
  createdAt: Date;
}

export type SocialChannel = "facebook" | "instagram";

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

/** Real PATCH semantics, same discipline as CustomerService.update()'s own
 * comment: a field left out of the call keeps its existing value. `null`
 * (not `undefined`) on startsAt/endsAt is the one explicit "clear this
 * date" signal — distinguishing "didn't mention it" from "remove it" the
 * same way a bare empty string does for CustomerService's own string
 * fields. Changing discountType (or any one of its own sub-fields, e.g.
 * bumping percentageOff without resending discountType) re-validates the
 * FULL resulting discount config, not just the field that changed — a
 * deal left in a self-contradictory state (e.g. percentage_off with no
 * percentageOff) is exactly the class of bug real PATCH semantics can
 * otherwise let through undetected. */
export interface UpdateDealInput {
  name?: string;
  discountType?: DiscountType;
  catalogItemIds?: string[];
  percentageOff?: number;
  buyQuantity?: number;
  freeQuantity?: number;
  fixedAmountOff?: number;
  startsAt?: Date | null;
  endsAt?: Date | null;
  isActive?: boolean;
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

  /** See UpdateDealInput's own comment for the exact PATCH semantics. Real
   * gap closed 2026-09-14 at the tenant's own request — this controller
   * had no update/deactivate route at all before now (disclosed in
   * DealsPage.tsx's own top comment, which this closes). */
  async update(tenantId: string, id: string, input: UpdateDealInput): Promise<Deal> {
    const existing = await this.store.findById(tenantId, id);
    if (!existing) throw new DealNotFoundError(id);

    const name = input.name !== undefined ? input.name.trim() : existing.name;
    const discountType = input.discountType ?? existing.discountType;
    const catalogItemIds = input.catalogItemIds ?? existing.catalogItemIds;
    const percentageOff = input.percentageOff !== undefined ? input.percentageOff : existing.percentageOff;
    const buyQuantity = input.buyQuantity !== undefined ? input.buyQuantity : existing.buyQuantity;
    const freeQuantity = input.freeQuantity !== undefined ? input.freeQuantity : existing.freeQuantity;
    const fixedAmountOff = input.fixedAmountOff !== undefined ? input.fixedAmountOff : existing.fixedAmountOff;

    if (!name) throw new InvalidDealError("name is required");
    if (catalogItemIds.length === 0) throw new InvalidDealError("a deal must apply to at least one catalog item");
    validateDiscount(discountType, percentageOff, buyQuantity, freeQuantity, fixedAmountOff);

    for (const catalogItemId of catalogItemIds) {
      const item = await this.catalogService.findById(tenantId, catalogItemId);
      if (!item) throw new InvalidDealError(`No catalog item found with id "${catalogItemId}" for this tenant`);
    }

    const updated: Deal = {
      ...existing,
      name,
      discountType,
      catalogItemIds,
      percentageOff,
      buyQuantity,
      freeQuantity,
      fixedAmountOff,
      startsAt: input.startsAt === null ? undefined : (input.startsAt ?? existing.startsAt),
      endsAt: input.endsAt === null ? undefined : (input.endsAt ?? existing.endsAt),
      isActive: input.isActive !== undefined ? input.isActive : existing.isActive,
    };
    await this.store.save(updated);
    return updated;
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

  /** Real record of a real push-to-channels event — DealsController's own
   * publish endpoint is the only caller, after the actual Graph API calls
   * it orchestrates have genuinely succeeded (never called speculatively
   * before the real post exists, same "log after success" discipline as
   * SocialPublishingController.createPost()'s own comment). */
  async recordPublish(tenantId: string, id: string, channels: SocialChannel[]): Promise<Deal> {
    const existing = await this.store.findById(tenantId, id);
    if (!existing) throw new DealNotFoundError(id);
    const updated: Deal = { ...existing, lastPublishedAt: new Date(), publishedChannels: channels };
    await this.store.save(updated);
    return updated;
  }

  /** A real, non-fabricated default promotional message built entirely
   * from the deal's own actual fields — never invented ad copy. The
   * caller (DealsController.publish()) may override this with real
   * custom copy of their own instead. */
  buildDefaultMessage(deal: Deal): string {
    const discount =
      deal.discountType === "percentage_off"
        ? `${deal.percentageOff}% off`
        : deal.discountType === "buy_x_get_y_free"
          ? `Buy ${deal.buyQuantity}, get ${deal.freeQuantity} free`
          : `${deal.fixedAmountOff} off`;
    const window = deal.endsAt ? ` Valid until ${deal.endsAt.toLocaleDateString()}.` : "";
    return `${deal.name}: ${discount}!${window}`;
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

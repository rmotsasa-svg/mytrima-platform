import { Inject, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { SALE_STORE } from "./sales.tokens";
import { DealService } from "../deals/deal.service";
import { RatingService } from "../reputation/rating.service";
import { NpsService } from "../growth-audit/nps.service";

/**
 * Master Plan Addendum v1.3, Section E: the Sales & Point-of-Sale module.
 * Every KPI the tenant asked to monitor is computed here, from real
 * transaction data — nothing is a pre-aggregated stored number (same
 * discipline as PettyCashService.getBalance()).
 */

export type SaleSource = "manual" | "imported";

export interface SaleLineItemInput {
  catalogItemId?: string;
  description?: string;
  quantity: number;
  unitPrice: number;
  isAddon?: boolean;
}

export interface SaleLineItem extends SaleLineItemInput {
  id: string;
  isAddon: boolean;
}

export interface RecordSaleInput {
  customerId?: string;
  recordedByUserId?: string;
  source?: SaleSource;
  occurredAt?: Date;
  dealId?: string;
  lineItems: SaleLineItemInput[];
}

export interface SaleTransaction {
  id: string;
  tenantId: string;
  customerId?: string;
  recordedByUserId?: string;
  source: SaleSource;
  occurredAt: Date;
  subtotalAmount: number;
  discountAmount: number;
  totalAmount: number;
  dealId?: string;
  lineItems: SaleLineItem[];
  createdAt: Date;
}

export interface SalesKpis {
  periodStart: Date;
  periodEnd: Date;
  transactionalVolume: number;
  salesAmount: number;
  averageTransactionValue: number;
  unitsPerTransaction: number;
  addonRate: number;
  conversionRate: number | null; // null when there are no engaged customers in the period to compute a rate over
}

export class InvalidSaleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidSaleError";
  }
}

export interface SaleStore {
  save(transaction: SaleTransaction): Promise<void>;
  /** periodStart/periodEnd, when given, filter by occurredAt — used by both
   * listing and every period-scoped KPI below. */
  findAllForTenant(tenantId: string, periodStart?: Date, periodEnd?: Date): Promise<SaleTransaction[]>;
}

function validateLineItems(lineItems: SaleLineItemInput[]): void {
  if (lineItems.length === 0) throw new InvalidSaleError("a sale needs at least one line item");
  for (const item of lineItems) {
    if (!item.catalogItemId && !item.description?.trim()) {
      throw new InvalidSaleError("each line item needs a catalogItemId or a description");
    }
    if (!Number.isFinite(item.quantity) || item.quantity <= 0) throw new InvalidSaleError("quantity must be a positive number");
    if (!Number.isFinite(item.unitPrice) || item.unitPrice < 0) throw new InvalidSaleError("unitPrice must be a non-negative number");
  }
}

@Injectable()
export class SaleService {
  constructor(
    @Inject(SALE_STORE) private readonly store: SaleStore,
    private readonly dealService: DealService,
    private readonly ratingService: RatingService,
    private readonly npsService: NpsService
  ) {}

  async recordSale(tenantId: string, id: string, input: RecordSaleInput): Promise<SaleTransaction> {
    validateLineItems(input.lineItems);

    // Real bug found running this against a real database: a line item's id
    // is a genuine `uuid` column (0009_sales.sql) — a derived string like
    // `${id}-0` is not valid uuid syntax and Postgres rejects the insert
    // outright. Each line item needs its own real UUID.
    const lineItems: SaleLineItem[] = input.lineItems.map((item) => ({ ...item, id: randomUUID(), isAddon: item.isAddon ?? false }));
    const subtotalAmount = Math.round(lineItems.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0) * 100) / 100;

    let discountAmount = 0;
    if (input.dealId) {
      const deal = await this.dealService.findById(tenantId, input.dealId);
      if (!deal) throw new InvalidSaleError(`No deal found with id "${input.dealId}"`);
      if (!deal.isActive) throw new InvalidSaleError(`Deal "${input.dealId}" is not active`);
      const now = input.occurredAt ?? new Date();
      if (deal.startsAt && now < deal.startsAt) throw new InvalidSaleError(`Deal "${input.dealId}" has not started yet`);
      if (deal.endsAt && now > deal.endsAt) throw new InvalidSaleError(`Deal "${input.dealId}" has already ended`);

      for (const item of lineItems) {
        if (item.catalogItemId && deal.catalogItemIds.includes(item.catalogItemId)) {
          const lineSubtotal = item.quantity * item.unitPrice;
          discountAmount += this.dealService.computeDiscount(deal, item.quantity, lineSubtotal, item.unitPrice);
        }
      }
      discountAmount = Math.round(discountAmount * 100) / 100;
    }

    const totalAmount = Math.max(0, Math.round((subtotalAmount - discountAmount) * 100) / 100);

    const transaction: SaleTransaction = {
      id,
      tenantId,
      customerId: input.customerId,
      recordedByUserId: input.recordedByUserId,
      source: input.source ?? "manual",
      occurredAt: input.occurredAt ?? new Date(),
      subtotalAmount,
      discountAmount,
      totalAmount,
      dealId: input.dealId,
      lineItems,
      createdAt: new Date(),
    };
    await this.store.save(transaction);
    return transaction;
  }

  async listForTenant(tenantId: string, periodStart?: Date, periodEnd?: Date): Promise<SaleTransaction[]> {
    return this.store.findAllForTenant(tenantId, periodStart, periodEnd);
  }

  /**
   * Every KPI the tenant asked to monitor (Master Plan Addendum v1.3, §E),
   * computed fresh from real data for the given period — see that section's
   * own table for each definition. conversionRate is the one KPI that reuses
   * data this module doesn't own (Rating/NPS) — see this method's own
   * conversion-rate block for exactly how that denominator is built.
   */
  async computeKpis(tenantId: string, periodStart: Date, periodEnd: Date): Promise<SalesKpis> {
    const sales = await this.store.findAllForTenant(tenantId, periodStart, periodEnd);
    const transactionalVolume = sales.length;
    const salesAmount = Math.round(sales.reduce((sum, s) => sum + s.totalAmount, 0) * 100) / 100;
    const averageTransactionValue = transactionalVolume > 0 ? Math.round((salesAmount / transactionalVolume) * 100) / 100 : 0;

    const totalUnits = sales.reduce((sum, s) => sum + s.lineItems.reduce((lineSum, li) => lineSum + li.quantity, 0), 0);
    const unitsPerTransaction = transactionalVolume > 0 ? Math.round((totalUnits / transactionalVolume) * 100) / 100 : 0;

    const transactionsWithAddon = sales.filter((s) => s.lineItems.some((li) => li.isAddon)).length;
    const addonRate = transactionalVolume > 0 ? Math.round((transactionsWithAddon / transactionalVolume) * 10000) / 100 : 0;

    // Conversion rate: of customers with a Rating or NPS response in the
    // period, % who also have >=1 sale in that period (Master Plan Addendum
    // v1.3, §E — the one KPI this system had no existing denominator for).
    const inPeriod = (at: Date) => at >= periodStart && at <= periodEnd;
    const [allRatings, allNps] = await Promise.all([this.ratingService.findAllForTenant(tenantId), this.npsService.findAllForTenant(tenantId)]);
    const engagedCustomerIds = new Set<string>([
      ...allRatings.filter((r) => inPeriod(r.submittedAt)).map((r) => r.customerId),
      ...allNps.filter((n) => inPeriod(n.submittedAt)).map((n) => n.customerId),
    ]);
    const buyingCustomerIds = new Set(sales.map((s) => s.customerId).filter((id): id is string => !!id));
    const convertedCount = [...engagedCustomerIds].filter((id) => buyingCustomerIds.has(id)).length;
    const conversionRate = engagedCustomerIds.size > 0 ? Math.round((convertedCount / engagedCustomerIds.size) * 10000) / 100 : null;

    return { periodStart, periodEnd, transactionalVolume, salesAmount, averageTransactionValue, unitsPerTransaction, addonRate, conversionRate };
  }
}

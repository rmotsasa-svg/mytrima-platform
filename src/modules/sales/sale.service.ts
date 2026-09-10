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
 *
 * `churnRate` and `computeLifetimeValue()` added 2026-09-10, sourced from a
 * real, user-provided reference document ("Essential Growth Strategy
 * KPIs") — this project's own established rule is that no KPI default or
 * formula gets invented without a citable source (see the addendum's own
 * "no fabricated industry-benchmark claim" note on the other Sales KPIs),
 * so these two use that document's own stated formulas, not a guess. See
 * each field/method's own comment for exactly how each formula's
 * ambiguous units were resolved. The same document's other KPIs — CAC,
 * LTV:CAC ratio, Net Revenue Retention, funnel-stage conversion, Lead
 * Velocity Rate — are NOT implemented: they need data this schema doesn't
 * track yet (marketing spend, a lead/MQL entity, recurring-revenue
 * concepts that don't fit this module's discrete-POS-transaction model) —
 * see README.md for the full gap analysis, deliberately not built without
 * a scope decision, same discipline as the merchant-of-record decision
 * before PayFast was built.
 *
 * `computeRepeatRate()` added 2026-09-10, prompted by a real reference
 * report the user supplied (a sample multi-location salon-chain quarterly
 * summary) that treated "does a new customer come back for a second visit"
 * as the single biggest lever on revenue — a real, distinct metric from
 * churnRate (which is about existing customers lapsing, not new ones never
 * returning at all). Fully computable from existing sale_transaction data,
 * no new schema.
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
  /** Sum of every line item's quantity across the period's transactions —
   * added 2026-09-10 alongside the social metrics work, at the tenant's own
   * request. Was already computed internally for unitsPerTransaction below
   * but never exposed on this interface. */
  totalUnits: number;
  unitsPerTransaction: number;
  addonRate: number;
  conversionRate: number | null; // null when there are no engaged customers in the period to compute a rate over
  /** Added 2026-09-10, sourced from the user-provided "Essential Growth
   * Strategy KPIs" reference doc: (Lost Customers during period ÷ Total
   * Customers at start of period) × 100 — the doc's own formula, applied
   * unchanged. "Start of period" = a real named customer with >=1 sale
   * before periodStart; "lost" = that customer has zero sales in
   * [periodStart, periodEnd]. null when there were no named customers
   * before periodStart to compute a rate over — not the same claim as 0%
   * churn. */
  churnRate: number | null;
}

export interface CustomerLifetimeValueResult {
  averageOrderValue: number;
  purchaseFrequencyPerYear: number;
  customerLifespanYears: number;
  lifetimeValue: number;
}

export interface RepeatRateResult {
  periodStart: Date;
  periodEnd: Date;
  /** Named customers whose FIRST-EVER sale (all-time, not just this
   * period) falls within [periodStart, periodEnd]. */
  newCustomerCount: number;
  /** Of those, how many have gone on to make a second sale at any point
   * after their first — no fixed window, since none is specified by any
   * cited source; a genuine second purchase at any later date counts. */
  repeatCustomerCount: number;
  /** null when newCustomerCount is 0 — not a fabricated 0%. */
  repeatRate: number | null;
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

    // Churn Rate — see SalesKpis's own comment for the exact formula and
    // source. Needs the full, unfiltered sale history (not just this
    // period) to know who counted as a "start of period" customer.
    const allSales = await this.store.findAllForTenant(tenantId);
    const startOfPeriodCustomerIds = new Set(
      allSales.filter((s) => s.occurredAt < periodStart && s.customerId).map((s) => s.customerId as string)
    );
    const lostCount = [...startOfPeriodCustomerIds].filter((id) => !buyingCustomerIds.has(id)).length;
    const churnRate = startOfPeriodCustomerIds.size > 0 ? Math.round((lostCount / startOfPeriodCustomerIds.size) * 10000) / 100 : null;

    return {
      periodStart,
      periodEnd,
      transactionalVolume,
      salesAmount,
      averageTransactionValue,
      totalUnits,
      unitsPerTransaction,
      addonRate,
      conversionRate,
      churnRate,
    };
  }

  /**
   * Customer Lifetime Value — sourced from the same reference doc as
   * churnRate above: "Average Order Value × Purchase Frequency × Customer
   * Lifespan." Unlike every other Sales KPI, this is NOT period-scoped —
   * "lifetime" is inherently an all-time concept, so this reads the
   * tenant's entire sale history, not a window.
   *
   * The source doc states the formula but not each factor's exact units —
   * a real ambiguity in the source itself, resolved here with one
   * consistent, documented interpretation rather than left implicit:
   *   - averageOrderValue = lifetime revenue ÷ lifetime order count.
   *   - purchaseFrequencyPerYear = (orders per named customer) ÷ that
   *     customer's average age (now − their first purchase, in years) —
   *     a genuine annualized rate, not a raw lifetime count, so it's
   *     dimensionally consistent to multiply by a lifespan in years below.
   *   - customerLifespanYears = average(last purchase − first purchase)
   *     in years, computed ONLY over customers with 2+ purchases — a
   *     customer with exactly one purchase has no observed span yet, and
   *     treating that as a 0-year lifespan would understate this number
   *     for a young or mostly-first-time customer base, not represent it
   *     honestly.
   *
   * Returns null — not a fabricated 0 — when there isn't enough real data
   * yet: no sales at all, no sales with a named customerId (walk-in/cash
   * sales can't contribute to a per-customer metric), or no repeat
   * customer yet to observe a real lifespan from.
   */
  async computeLifetimeValue(tenantId: string): Promise<CustomerLifetimeValueResult | null> {
    const allSales = await this.store.findAllForTenant(tenantId);
    if (allSales.length === 0) return null;

    const totalRevenue = Math.round(allSales.reduce((sum, s) => sum + s.totalAmount, 0) * 100) / 100;
    const averageOrderValue = Math.round((totalRevenue / allSales.length) * 100) / 100;

    const purchaseDatesByCustomer = new Map<string, Date[]>();
    for (const sale of allSales) {
      if (!sale.customerId) continue;
      const dates = purchaseDatesByCustomer.get(sale.customerId) ?? [];
      dates.push(sale.occurredAt);
      purchaseDatesByCustomer.set(sale.customerId, dates);
    }
    if (purchaseDatesByCustomer.size === 0) return null;

    const MS_PER_YEAR = 365 * 24 * 60 * 60 * 1000;
    const now = Date.now();

    const totalNamedOrders = [...purchaseDatesByCustomer.values()].reduce((sum, dates) => sum + dates.length, 0);
    const customerAgesYears = [...purchaseDatesByCustomer.values()].map(
      (dates) => (now - Math.min(...dates.map((d) => d.getTime()))) / MS_PER_YEAR
    );
    const averageCustomerAgeYears = customerAgesYears.reduce((sum, age) => sum + age, 0) / customerAgesYears.length;
    const purchasesPerCustomer = totalNamedOrders / purchaseDatesByCustomer.size;
    const purchaseFrequencyPerYear =
      averageCustomerAgeYears > 0 ? Math.round((purchasesPerCustomer / averageCustomerAgeYears) * 100) / 100 : 0;

    const repeatCustomerSpansYears = [...purchaseDatesByCustomer.values()]
      .filter((dates) => dates.length >= 2)
      .map((dates) => (Math.max(...dates.map((d) => d.getTime())) - Math.min(...dates.map((d) => d.getTime()))) / MS_PER_YEAR);
    if (repeatCustomerSpansYears.length === 0) return null;
    const customerLifespanYears =
      Math.round((repeatCustomerSpansYears.reduce((sum, span) => sum + span, 0) / repeatCustomerSpansYears.length) * 100) / 100;

    const lifetimeValue = Math.round(averageOrderValue * purchaseFrequencyPerYear * customerLifespanYears * 100) / 100;

    return { averageOrderValue, purchaseFrequencyPerYear, customerLifespanYears, lifetimeValue };
  }

  /** See RepeatRateResult's own comment for the exact definition. Needs
   * the full, unfiltered sale history (like computeLifetimeValue()) to
   * know whether a customer's first-ever sale really was their first, and
   * whether they ever came back — not just what happened within the
   * requested period. */
  async computeRepeatRate(tenantId: string, periodStart: Date, periodEnd: Date): Promise<RepeatRateResult> {
    const allSales = await this.store.findAllForTenant(tenantId);

    const purchaseDatesByCustomer = new Map<string, Date[]>();
    for (const sale of allSales) {
      if (!sale.customerId) continue;
      const dates = purchaseDatesByCustomer.get(sale.customerId) ?? [];
      dates.push(sale.occurredAt);
      purchaseDatesByCustomer.set(sale.customerId, dates);
    }

    let newCustomerCount = 0;
    let repeatCustomerCount = 0;
    for (const dates of purchaseDatesByCustomer.values()) {
      const sorted = [...dates].sort((a, b) => a.getTime() - b.getTime());
      const firstPurchase = sorted[0];
      if (firstPurchase >= periodStart && firstPurchase <= periodEnd) {
        newCustomerCount++;
        if (sorted.length >= 2) repeatCustomerCount++;
      }
    }

    const repeatRate = newCustomerCount > 0 ? Math.round((repeatCustomerCount / newCustomerCount) * 10000) / 100 : null;
    return { periodStart, periodEnd, newCustomerCount, repeatCustomerCount, repeatRate };
  }
}

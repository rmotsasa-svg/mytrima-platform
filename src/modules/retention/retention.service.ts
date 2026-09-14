import { Injectable } from "@nestjs/common";
import { SaleService, RepeatRateResult } from "../sales/sale.service";
import { CustomerService } from "../customers/customer.service";

/**
 * Phase 6 of the GrowthOS-aligned restructuring plan
 * (C:\Users\USER\.claude\plans\twinkly-sprouting-orbit.md). Deliberately
 * read-only — no new writable entity, no new store, no migration. Every
 * number here is derived from data that already exists (`Sale.customerId`/
 * `occurredAt`, `Customer`, `SaleService.computeRepeatRate()`), the same
 * "compute, don't store the derived value" discipline as
 * DealService.computeDiscount()/GoalService's computeProgressPct().
 *
 * A standalone service (not a CustomerService method) because this genuinely
 * needs both Customers and Sales — CustomerModule already imports
 * SalesModule for other reasons, but bolting sales-shaped logic onto
 * CustomerService itself would blur what that service owns.
 */

export interface RetentionCustomer {
  customerId: string;
  displayName?: string;
  phone?: string;
  email?: string;
  lastPurchaseAt: Date;
  daysSinceLastPurchase: number;
  /** How many purchases this customer has made, all-time — the one real
   * signal that separates a "reactivation candidate" (was genuinely
   * engaged, worth winning back) from a customer who bought once and
   * never returned (less compelling to specifically target). */
  totalPurchases: number;
}

export interface RetentionSummary {
  atRiskThresholdDays: number;
  inactiveThresholdDays: number;
  /** Between atRiskThresholdDays and inactiveThresholdDays, exclusive of
   * the inactive band below — a customer is in exactly one of
   * atRisk/inactive, never both. */
  atRisk: RetentionCustomer[];
  /** inactiveThresholdDays or more since their last purchase. */
  inactive: RetentionCustomer[];
  /** The subset of `inactive` with 2+ historical purchases — see
   * RetentionCustomer.totalPurchases's own comment. */
  reactivationCandidates: RetentionCustomer[];
  /** SaleService's own real computeRepeatRate(), over a rolling window
   * ending now matching inactiveThresholdDays — reused verbatim, never
   * recomputed here. */
  repeatRate: RepeatRateResult;
}

const DEFAULT_AT_RISK_THRESHOLD_DAYS = 60;
const DEFAULT_INACTIVE_THRESHOLD_DAYS = 90;

function daysSince(date: Date, now: Date): number {
  return Math.floor((now.getTime() - date.getTime()) / (24 * 60 * 60 * 1000));
}

@Injectable()
export class RetentionService {
  constructor(
    private readonly saleService: SaleService,
    private readonly customerService: CustomerService
  ) {}

  async retentionSummary(
    tenantId: string,
    now: Date = new Date(),
    atRiskThresholdDays = DEFAULT_AT_RISK_THRESHOLD_DAYS,
    inactiveThresholdDays = DEFAULT_INACTIVE_THRESHOLD_DAYS
  ): Promise<RetentionSummary> {
    const [sales, customers] = await Promise.all([this.saleService.listForTenant(tenantId), this.customerService.listForTenant(tenantId)]);
    const customerById = new Map(customers.map((c) => [c.id, c]));

    const purchasesByCustomer = new Map<string, Date[]>();
    for (const sale of sales) {
      if (!sale.customerId) continue; // walk-in/cash sale — nothing to attribute retention to
      const dates = purchasesByCustomer.get(sale.customerId) ?? [];
      dates.push(sale.occurredAt);
      purchasesByCustomer.set(sale.customerId, dates);
    }

    const atRisk: RetentionCustomer[] = [];
    const inactive: RetentionCustomer[] = [];
    const reactivationCandidates: RetentionCustomer[] = [];

    for (const [customerId, dates] of purchasesByCustomer) {
      const customer = customerById.get(customerId);
      if (!customer) continue; // a customer record that no longer exists has nothing real to show

      const lastPurchaseAt = new Date(Math.max(...dates.map((d) => d.getTime())));
      const entry: RetentionCustomer = {
        customerId,
        displayName: customer.displayName,
        phone: customer.phone,
        email: customer.email,
        lastPurchaseAt,
        daysSinceLastPurchase: daysSince(lastPurchaseAt, now),
        totalPurchases: dates.length,
      };

      if (entry.daysSinceLastPurchase >= inactiveThresholdDays) {
        inactive.push(entry);
        if (entry.totalPurchases >= 2) reactivationCandidates.push(entry);
      } else if (entry.daysSinceLastPurchase >= atRiskThresholdDays) {
        atRisk.push(entry);
      }
    }

    const byDaysDesc = (a: RetentionCustomer, b: RetentionCustomer) => b.daysSinceLastPurchase - a.daysSinceLastPurchase;
    atRisk.sort(byDaysDesc);
    inactive.sort(byDaysDesc);
    reactivationCandidates.sort(byDaysDesc);

    const periodStart = new Date(now.getTime() - inactiveThresholdDays * 24 * 60 * 60 * 1000);
    const repeatRate = await this.saleService.computeRepeatRate(tenantId, periodStart, now);

    return { atRiskThresholdDays, inactiveThresholdDays, atRisk, inactive, reactivationCandidates, repeatRate };
  }
}

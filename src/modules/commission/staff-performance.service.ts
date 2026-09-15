import { Injectable } from "@nestjs/common";
import { SaleService } from "../sales/sale.service";
import { CustomerService } from "../customers/customer.service";
import { CommissionService, computeCommission } from "./commission.service";

/**
 * "Track staff performance" — the tenant's own explicit request
 * (2026-09-15). Composes real data three other services already own —
 * SaleService's own per-staff sales figures (computeSalesForUser(), added
 * alongside this), CustomerService's own createdByUserId/updatedByUserId/
 * updatedAt (added alongside this too), and CommissionService's own rate —
 * rather than inventing a fourth store to duplicate any of it. Lives in
 * its own module (not inside AuthModule/StaffController) specifically to
 * avoid a real DI cycle: SalesModule already imports AuthModule (for
 * AccessTokenGuard), so AuthModule importing SalesModule back would be a
 * genuine two-way module cycle — see commission.module.ts's own comment.
 */
export interface StaffPerformance {
  userId: string;
  periodStart: Date;
  periodEnd: Date;
  salesCount: number;
  salesAmount: number;
  /** Customers whose createdByUserId is this user AND whose createdAt
   * falls in the period. */
  customersCreated: number;
  /** Customers whose MOST RECENT editor (updatedByUserId) is this user AND
   * whose updatedAt falls in the period. DISCLOSED LIMITATION: this only
   * reflects the latest edit, not a full edit history — a customer edited
   * by staff-A then staff-B within the same period counts only toward
   * staff-B here, even though staff-A also touched it. A real edit-history
   * table would be the fix if per-edit attribution (not just "who most
   * recently touched it") ever became a real requirement — no product
   * spec asks for that today. */
  customersUpdated: number;
  commissionRatePercent: number | null;
  /** computeCommission(salesAmount, commissionRatePercent ?? 0) — 0 when
   * no rate is set, not null, since "no rate configured" and "a real 0%
   * rate" both mean the same real number is owed: nothing. */
  commissionEarned: number;
}

@Injectable()
export class StaffPerformanceService {
  constructor(
    private readonly saleService: SaleService,
    private readonly customerService: CustomerService,
    private readonly commissionService: CommissionService
  ) {}

  async computeForUser(tenantId: string, userId: string, periodStart: Date, periodEnd: Date): Promise<StaffPerformance> {
    const [salesSummary, customers, rate] = await Promise.all([
      this.saleService.computeSalesForUser(tenantId, userId, periodStart, periodEnd),
      this.customerService.listForTenant(tenantId),
      this.commissionService.getRateForUser(tenantId, userId),
    ]);

    const inPeriod = (at: Date) => at >= periodStart && at <= periodEnd;
    const customersCreated = customers.filter((c) => c.createdByUserId === userId && inPeriod(c.createdAt)).length;
    const customersUpdated = customers.filter((c) => c.updatedByUserId === userId && inPeriod(c.updatedAt)).length;

    const commissionRatePercent = rate?.ratePercent ?? null;
    const commissionEarned = computeCommission(salesSummary.salesAmount, commissionRatePercent ?? 0);

    return {
      userId,
      periodStart,
      periodEnd,
      salesCount: salesSummary.salesCount,
      salesAmount: salesSummary.salesAmount,
      customersCreated,
      customersUpdated,
      commissionRatePercent,
      commissionEarned,
    };
  }

  /** Every staff account's performance for the same period, one call —
   * the "Staff performance" table an owner/manager actually wants to
   * scan, not N separate round trips. */
  async computeForTenant(tenantId: string, userIds: string[], periodStart: Date, periodEnd: Date): Promise<StaffPerformance[]> {
    return Promise.all(userIds.map((userId) => this.computeForUser(tenantId, userId, periodStart, periodEnd)));
  }
}

import { Inject, Injectable } from "@nestjs/common";
import { COMMISSION_RATE_STORE } from "./commission.tokens";

/**
 * "Add staff commission module" — the tenant's own explicit request
 * (2026-09-15). One active rate per staff member — setRate() replaces
 * whatever rate that staff member had before, it does not add a second
 * row. No product spec exists for historical rate versioning ("what rate
 * applied to a sale from before a raise") — same "don't build a
 * permission/feature split nothing has asked for" discipline as rbac.ts's
 * own top comment; a real per-period rate history would be the fix if
 * that ever became a real requirement.
 *
 * Commission EARNED is deliberately not computed here — see
 * StaffPerformanceService, which composes this rate with SaleService's own
 * real per-staff sales figures (computeSalesForUser()). This module only
 * owns the rate itself.
 */

export interface CommissionRate {
  id: string;
  tenantId: string;
  userId: string;
  /** 0-100, a percentage of a staff member's own sales for a period. */
  ratePercent: number;
  createdAt: Date;
}

export class InvalidCommissionRateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidCommissionRateError";
  }
}

export interface CommissionRateStore {
  /** Upserts on (tenantId, userId), not on `id` — see this file's own top
   * comment on why there is only ever one active rate per staff member. */
  save(rate: CommissionRate): Promise<void>;
  findForUser(tenantId: string, userId: string): Promise<CommissionRate | null>;
  findAllForTenant(tenantId: string): Promise<CommissionRate[]>;
}

function validateRatePercent(ratePercent: number): void {
  if (!Number.isFinite(ratePercent) || ratePercent < 0 || ratePercent > 100) {
    throw new InvalidCommissionRateError(`ratePercent must be a number between 0 and 100, got ${ratePercent}`);
  }
}

@Injectable()
export class CommissionService {
  constructor(@Inject(COMMISSION_RATE_STORE) private readonly store: CommissionRateStore) {}

  async setRate(tenantId: string, id: string, userId: string, ratePercent: number): Promise<CommissionRate> {
    validateRatePercent(ratePercent);
    const rate: CommissionRate = { id, tenantId, userId, ratePercent, createdAt: new Date() };
    await this.store.save(rate);
    return rate;
  }

  async getRateForUser(tenantId: string, userId: string): Promise<CommissionRate | null> {
    return this.store.findForUser(tenantId, userId);
  }

  async listRatesForTenant(tenantId: string): Promise<CommissionRate[]> {
    return this.store.findAllForTenant(tenantId);
  }
}

/** Pure — commission EARNED is always computed fresh against a real sales
 * figure, never stored (same "compute, never store the derived value"
 * discipline as PettyCashService.getBalance()/computeProgressPct()
 * elsewhere in this codebase). Rounded to 2 decimal places, same
 * convention every other money figure in this codebase uses. */
export function computeCommission(salesAmount: number, ratePercent: number): number {
  return Math.round(salesAmount * ratePercent) / 100;
}

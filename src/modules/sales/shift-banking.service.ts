import { Inject, Injectable } from "@nestjs/common";
import { SHIFT_BANKING_STORE } from "./sales.tokens";
import { SaleService } from "./sale.service";
import { RefundService } from "./refund.service";

/**
 * "Allow staff to do daily shift end banking" — real gap closed 2026-09-14
 * at the tenant's own explicit request. A real end-of-shift cash-up: staff
 * physically counts the till, this computes what the till SHOULD have
 * (from real recorded cash sales), and the difference (`variance`) is the
 * real, honest signal of whether the count matches the books — never
 * fabricated, never silently hidden.
 *
 * `expectedCashAmount` = sum of `payment_method = 'cash'` sales in the
 * period, minus total refunds in the period. ONE DISCLOSED SIMPLIFICATION:
 * a refund doesn't itself record which payment method the original sale
 * used, so every refund is assumed to reduce cash on hand regardless — the
 * exact same assumption `SalesController`'s own `netSalesAmount` already
 * makes for the overall (not cash-specific) sales figure. A shift with
 * refunds against non-cash sales will therefore show a real variance that
 * isn't actually a counting error — visible in the record's own
 * `notes`/context, not hidden, but not automatically corrected for either
 * (this schema has no way to know better yet).
 *
 * `expectedCashAmount` is SNAPSHOTTED into the record at close time, never
 * recomputed later — a real cash-up record is a point-in-time
 * reconciliation, the same reason a paper till slip is never silently
 * rewritten after the fact (a sale corrected/refunded after the shift
 * closes must not retroactively change what that shift's own close-out
 * said).
 */

export interface ShiftBanking {
  id: string;
  tenantId: string;
  periodStart: Date;
  periodEnd: Date;
  expectedCashAmount: number;
  countedCashAmount: number;
  bankedAmount: number;
  notes?: string;
  recordedByUserId?: string;
  createdAt: Date;
}

export class InvalidShiftBankingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidShiftBankingError";
  }
}

export interface ShiftBankingStore {
  save(record: ShiftBanking): Promise<void>;
  findAllForTenant(tenantId: string): Promise<ShiftBanking[]>;
}

@Injectable()
export class ShiftBankingService {
  constructor(
    @Inject(SHIFT_BANKING_STORE) private readonly store: ShiftBankingStore,
    private readonly saleService: SaleService,
    private readonly refundService: RefundService
  ) {}

  /** Real, non-fabricated "what should be in the till" for a period —
   * separated from closeShift() so the P.O.S. page can show it to staff
   * BEFORE they commit to a count (the same "preview, then confirm"
   * pattern every other real financial action in this app already
   * follows). */
  async computeExpectedCash(tenantId: string, periodStart: Date, periodEnd: Date): Promise<number> {
    const sales = await this.saleService.listForTenant(tenantId, periodStart, periodEnd);
    const cashSalesTotal = sales.filter((s) => s.paymentMethod === "cash").reduce((sum, s) => sum + s.totalAmount, 0);
    const refunded = await this.refundService.totalRefundedForPeriod(tenantId, periodStart, periodEnd);
    return Math.round((cashSalesTotal - refunded) * 100) / 100;
  }

  async closeShift(
    tenantId: string,
    id: string,
    periodStart: Date,
    periodEnd: Date,
    countedCashAmount: number,
    bankedAmount: number,
    notes?: string,
    recordedByUserId?: string
  ): Promise<ShiftBanking> {
    if (periodEnd <= periodStart) throw new InvalidShiftBankingError("periodEnd must be after periodStart");
    if (!Number.isFinite(countedCashAmount) || countedCashAmount < 0) {
      throw new InvalidShiftBankingError("countedCashAmount must be a non-negative number");
    }
    if (!Number.isFinite(bankedAmount) || bankedAmount < 0) {
      throw new InvalidShiftBankingError("bankedAmount must be a non-negative number");
    }

    const expectedCashAmount = await this.computeExpectedCash(tenantId, periodStart, periodEnd);
    const record: ShiftBanking = {
      id,
      tenantId,
      periodStart,
      periodEnd,
      expectedCashAmount,
      countedCashAmount,
      bankedAmount,
      notes: notes?.trim() || undefined,
      recordedByUserId,
      createdAt: new Date(),
    };
    await this.store.save(record);
    return record;
  }

  async listForTenant(tenantId: string): Promise<ShiftBanking[]> {
    const records = await this.store.findAllForTenant(tenantId);
    return [...records].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  /** counted - expected: positive means more cash was counted than the
   * books say should be there; negative means less. Computed on read, per
   * the same "never store a derived value" discipline as
   * PettyCashService.getBalance(). */
  variance(record: ShiftBanking): number {
    return Math.round((record.countedCashAmount - record.expectedCashAmount) * 100) / 100;
  }
}

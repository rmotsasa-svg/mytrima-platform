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
 *
 * `denominationCounts` — real note/coin breakdown, added 2026-09-14 at the
 * tenant's own explicit request. Optional (a tenant can still enter one
 * lump `countedCashAmount`, as before), but when given it's real
 * validated data, not decorative: every key must be one of the fixed
 * `DENOMINATIONS` this platform actually recognizes, every count a
 * non-negative integer, and the breakdown's own total must equal
 * `countedCashAmount` exactly (to the cent) — a real arithmetic check
 * that catches a miscount or a typo before it's recorded as this shift's
 * official figure, not a client-side convenience that's silently ignored
 * server-side.
 */

/** Lesotho loti / South African rand note and coin denominations — the
 * exact set the tenant named. A fixed, closed list (not free-form) so a
 * denomination breakdown is always real, comparable data, never an
 * arbitrary key a client could invent. */
export const DENOMINATIONS = ["0.10", "0.20", "0.50", "1.00", "2.00", "5.00", "10.00", "20.00", "50.00", "100.00", "200.00"] as const;
export type Denomination = (typeof DENOMINATIONS)[number];

export interface ShiftBanking {
  id: string;
  tenantId: string;
  periodStart: Date;
  periodEnd: Date;
  expectedCashAmount: number;
  countedCashAmount: number;
  denominationCounts?: Partial<Record<Denomination, number>>;
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
  findById(tenantId: string, id: string): Promise<ShiftBanking | null>;
}

/** Real arithmetic check, not decorative — throws the exact real
 * discrepancy (in cents, to avoid floating-point false positives) rather
 * than silently accepting a breakdown that doesn't actually add up to the
 * counted total it's supposed to explain. */
function validateDenominationCounts(counts: Partial<Record<Denomination, number>>, countedCashAmount: number): void {
  let total = 0;
  for (const [key, count] of Object.entries(counts)) {
    if (!DENOMINATIONS.includes(key as Denomination)) {
      throw new InvalidShiftBankingError(`"${key}" is not a real denomination — must be one of: ${DENOMINATIONS.join(", ")}`);
    }
    if (!Number.isInteger(count) || count! < 0) {
      throw new InvalidShiftBankingError(`The count for denomination ${key} must be a non-negative whole number`);
    }
    total += Number(key) * count!;
  }
  const totalCents = Math.round(total * 100);
  const countedCents = Math.round(countedCashAmount * 100);
  if (totalCents !== countedCents) {
    throw new InvalidShiftBankingError(
      `The denomination breakdown adds up to ${(totalCents / 100).toFixed(2)}, which doesn't match the counted cash amount of ${countedCashAmount.toFixed(2)}`
    );
  }
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
    recordedByUserId?: string,
    denominationCounts?: Partial<Record<Denomination, number>>
  ): Promise<ShiftBanking> {
    if (periodEnd <= periodStart) throw new InvalidShiftBankingError("periodEnd must be after periodStart");
    if (!Number.isFinite(countedCashAmount) || countedCashAmount < 0) {
      throw new InvalidShiftBankingError("countedCashAmount must be a non-negative number");
    }
    if (!Number.isFinite(bankedAmount) || bankedAmount < 0) {
      throw new InvalidShiftBankingError("bankedAmount must be a non-negative number");
    }
    if (denominationCounts) validateDenominationCounts(denominationCounts, countedCashAmount);

    const expectedCashAmount = await this.computeExpectedCash(tenantId, periodStart, periodEnd);
    const record: ShiftBanking = {
      id,
      tenantId,
      periodStart,
      periodEnd,
      expectedCashAmount,
      countedCashAmount,
      denominationCounts,
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

  async findById(tenantId: string, id: string): Promise<ShiftBanking | null> {
    return this.store.findById(tenantId, id);
  }

  /** counted - expected: positive means more cash was counted than the
   * books say should be there; negative means less. Computed on read, per
   * the same "never store a derived value" discipline as
   * PettyCashService.getBalance(). */
  variance(record: ShiftBanking): number {
    return Math.round((record.countedCashAmount - record.expectedCashAmount) * 100) / 100;
  }

  /**
   * "Allow staff to send slips on WhatsApp or email" — real, non-fabricated
   * text built entirely from this record's own real fields, including the
   * real denomination breakdown when one was given. The only caller is
   * SalesController.sendShiftBankingSlip(), which is the actual real send
   * (email or WhatsApp) — this method only builds the content.
   */
  buildSlipText(record: ShiftBanking, tenantName: string): string {
    const lines = [
      `${tenantName} — Shift banking slip`,
      `Period: ${record.periodStart.toLocaleString()} – ${record.periodEnd.toLocaleString()}`,
      `Expected cash: ${record.expectedCashAmount.toFixed(2)}`,
      `Counted cash: ${record.countedCashAmount.toFixed(2)}`,
      `Variance: ${this.variance(record) >= 0 ? "+" : ""}${this.variance(record).toFixed(2)}`,
      `Banked: ${record.bankedAmount.toFixed(2)}`,
    ];
    if (record.denominationCounts && Object.keys(record.denominationCounts).length > 0) {
      lines.push("Denomination breakdown:");
      for (const denom of DENOMINATIONS) {
        const count = record.denominationCounts[denom];
        if (count) lines.push(`  ${denom} x ${count} = ${(Number(denom) * count).toFixed(2)}`);
      }
    }
    if (record.notes) lines.push(`Notes: ${record.notes}`);
    return lines.join("\n");
  }
}

import { Inject, Injectable } from "@nestjs/common";
import { PETTY_CASH_STORE } from "./petty-cash.tokens";
import { VendorService } from "./vendor.service";

/**
 * Master Plan Addendum v1.3, Section G: cash going OUT to a tenant's own
 * suppliers — a single running ledger, not double-entry bookkeeping. Balance
 * is always computed from the ledger, never stored, so it can never drift
 * out of sync with its own transaction history.
 */

export type PettyCashTransactionType = "replenishment" | "vendor_payment";

export interface PettyCashTransaction {
  id: string;
  tenantId: string;
  vendorId?: string;
  type: PettyCashTransactionType;
  amount: number;
  description?: string;
  recordedByUserId?: string;
  occurredAt: Date;
}

export class InvalidPettyCashTransactionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidPettyCashTransactionError";
  }
}

export interface PettyCashStore {
  save(transaction: PettyCashTransaction): Promise<void>;
  findAllForTenant(tenantId: string): Promise<PettyCashTransaction[]>;
}

@Injectable()
export class PettyCashService {
  constructor(
    @Inject(PETTY_CASH_STORE) private readonly store: PettyCashStore,
    private readonly vendorService: VendorService
  ) {}

  async replenish(tenantId: string, id: string, amount: number, description?: string, recordedByUserId?: string): Promise<PettyCashTransaction> {
    if (!Number.isFinite(amount) || amount <= 0) throw new InvalidPettyCashTransactionError("amount must be a positive number");
    const transaction: PettyCashTransaction = { id, tenantId, type: "replenishment", amount, description: description?.trim() || undefined, recordedByUserId, occurredAt: new Date() };
    await this.store.save(transaction);
    return transaction;
  }

  async payVendor(tenantId: string, id: string, vendorId: string, amount: number, description?: string, recordedByUserId?: string): Promise<PettyCashTransaction> {
    if (!Number.isFinite(amount) || amount <= 0) throw new InvalidPettyCashTransactionError("amount must be a positive number");
    const vendor = await this.vendorService.findById(tenantId, vendorId);
    if (!vendor) throw new InvalidPettyCashTransactionError(`No vendor found with id "${vendorId}"`);
    const transaction: PettyCashTransaction = { id, tenantId, vendorId, type: "vendor_payment", amount, description: description?.trim() || undefined, recordedByUserId, occurredAt: new Date() };
    await this.store.save(transaction);
    return transaction;
  }

  async getLedger(tenantId: string): Promise<PettyCashTransaction[]> {
    return this.store.findAllForTenant(tenantId);
  }

  /** sum(replenishments) - sum(vendor payments) — computed on read, per the
   * addendum's own "a single running ledger" decision (no stored balance
   * column to drift out of sync). */
  async getBalance(tenantId: string): Promise<number> {
    const ledger = await this.getLedger(tenantId);
    return ledger.reduce((balance, t) => (t.type === "replenishment" ? balance + t.amount : balance - t.amount), 0);
  }
}

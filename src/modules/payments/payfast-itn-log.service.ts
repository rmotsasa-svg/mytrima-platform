import { Inject, Injectable } from "@nestjs/common";
import { PAYFAST_ITN_LOG_STORE } from "./payments.tokens";

/**
 * A real, minimal audit trail of every ITN this platform has genuinely
 * received and verified — see migration 0015's own comment on why this is
 * deliberately NOT an order/invoice/fulfillment table. Recorded regardless
 * of whether verification passed, so a failed/tampered ITN attempt is
 * still visible, not silently dropped.
 */
export interface PayfastItnLogEntry {
  id: string;
  tenantId: string;
  mPaymentId: string;
  pfPaymentId: string;
  paymentStatus: string;
  amountGross?: string;
  signatureValid: boolean;
  serverConfirmed: boolean;
  rawPayload: Record<string, string>;
  receivedAt: Date;
}

export interface PayfastItnLogStore {
  save(entry: PayfastItnLogEntry): Promise<void>;
  findByTenant(tenantId: string): Promise<PayfastItnLogEntry[]>;
}

@Injectable()
export class PayfastItnLogService {
  constructor(@Inject(PAYFAST_ITN_LOG_STORE) private readonly store: PayfastItnLogStore) {}

  async record(entry: Omit<PayfastItnLogEntry, "receivedAt">): Promise<void> {
    await this.store.save({ ...entry, receivedAt: new Date() });
  }

  async listForTenant(tenantId: string): Promise<PayfastItnLogEntry[]> {
    return this.store.findByTenant(tenantId);
  }
}

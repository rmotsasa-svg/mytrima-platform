import { Inject, Injectable } from "@nestjs/common";
import { REFUND_STORE } from "./sales.tokens";
import { SaleService } from "./sale.service";

/**
 * Real gap closed 2026-09-12, at the tenant's own explicit request: the
 * P.O.S. page (formerly "Sales") needed to process refunds and exchanges,
 * and this module previously had no concept of either.
 *
 * DELIBERATE DESIGN DECISION: "exchange" is NOT modeled as its own concept
 * here. An exchange is a refund of the returned item(s) — recordRefund()
 * below — followed by an ordinary new sale for the replacement item(s)
 * (SaleService.recordSale(), completely unchanged). The P.O.S. page
 * composes those two already-real primitives in one user-facing action;
 * nothing on the backend needs a third "exchange" entity, and nothing
 * downstream (KPIs, product contribution, the Business Snapshot) needs to
 * special-case a transaction type it already knows how to handle. This
 * mirrors this module's own established discipline of not inventing a
 * capability a citable source or an actual scoped need doesn't call for.
 */

export interface RefundLineItemInput {
  catalogItemId?: string;
  description?: string;
  quantity: number;
  unitPrice: number;
}

export interface SaleRefund {
  id: string;
  tenantId: string;
  saleId: string;
  reason?: string;
  refundAmount: number;
  lineItems: RefundLineItemInput[];
  recordedByUserId?: string;
  createdAt: Date;
}

export class InvalidRefundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidRefundError";
  }
}

export class SaleNotFoundError extends Error {
  constructor(id: string) {
    super(`No sale found with id "${id}"`);
    this.name = "SaleNotFoundError";
  }
}

export interface RefundStore {
  save(refund: SaleRefund): Promise<void>;
  findAllForSale(tenantId: string, saleId: string): Promise<SaleRefund[]>;
  /** periodStart/periodEnd filter by createdAt — same convention as
   * SaleStore.findAllForTenant(), used to net refunds against gross sales
   * for a given reporting period (KPIs, Business Snapshot). */
  findAllForTenant(tenantId: string, periodStart?: Date, periodEnd?: Date): Promise<SaleRefund[]>;
}

/** Groups a sale's (or a refund's) line items by a real identity key —
 * catalogItemId when present, else the free-text description, else a
 * shared bucket — so quantities sold/already-refunded can be compared
 * per real product/service, not just summed across the whole sale. */
function lineItemKey(item: { catalogItemId?: string; description?: string }): string {
  return item.catalogItemId ?? item.description ?? "__unspecified__";
}

function sumQuantitiesByKey(lineItems: { catalogItemId?: string; description?: string; quantity: number }[]): Map<string, number> {
  const totals = new Map<string, number>();
  for (const item of lineItems) {
    const key = lineItemKey(item);
    totals.set(key, (totals.get(key) ?? 0) + item.quantity);
  }
  return totals;
}

@Injectable()
export class RefundService {
  constructor(
    @Inject(REFUND_STORE) private readonly store: RefundStore,
    private readonly saleService: SaleService
  ) {}

  /**
   * Records a real refund against a real, existing sale. Validates that
   * the refunded quantity for each real product/service never exceeds
   * what that sale actually sold, net of anything already refunded on it
   * — the real business rule a POS refund exists to enforce (you cannot
   * refund three units of something the customer only bought two of, nor
   * refund the same unit twice across two separate refund requests).
   */
  async recordRefund(
    tenantId: string,
    id: string,
    saleId: string,
    lineItems: RefundLineItemInput[],
    reason?: string,
    recordedByUserId?: string
  ): Promise<SaleRefund> {
    if (lineItems.length === 0) throw new InvalidRefundError("a refund needs at least one line item");
    for (const item of lineItems) {
      if (!Number.isFinite(item.quantity) || item.quantity <= 0) throw new InvalidRefundError("quantity must be a positive number");
      if (!Number.isFinite(item.unitPrice) || item.unitPrice < 0) throw new InvalidRefundError("unitPrice must be a non-negative number");
    }

    const sale = await this.saleService.findById(tenantId, saleId);
    if (!sale) throw new SaleNotFoundError(saleId);

    const existingRefunds = await this.store.findAllForSale(tenantId, saleId);
    const alreadyRefunded = sumQuantitiesByKey(existingRefunds.flatMap((r) => r.lineItems));
    const sold = sumQuantitiesByKey(sale.lineItems);

    for (const item of lineItems) {
      const key = lineItemKey(item);
      const remaining = (sold.get(key) ?? 0) - (alreadyRefunded.get(key) ?? 0);
      if (item.quantity > remaining) {
        throw new InvalidRefundError(
          `cannot refund ${item.quantity} unit(s) of "${key}" on this sale — only ${Math.max(remaining, 0)} unit(s) remain refundable`
        );
      }
    }

    const refundAmount = Math.round(lineItems.reduce((sum, li) => sum + li.quantity * li.unitPrice, 0) * 100) / 100;

    const refund: SaleRefund = { id, tenantId, saleId, reason, refundAmount, lineItems, recordedByUserId, createdAt: new Date() };
    await this.store.save(refund);
    return refund;
  }

  async listForSale(tenantId: string, saleId: string): Promise<SaleRefund[]> {
    return this.store.findAllForSale(tenantId, saleId);
  }

  async listForTenant(tenantId: string, periodStart?: Date, periodEnd?: Date): Promise<SaleRefund[]> {
    return this.store.findAllForTenant(tenantId, periodStart, periodEnd);
  }

  /** Real total refunded in a period, for netting against gross sales —
   * SaleService.computeKpis()'s own `refundedAmount`/`netSalesAmount`
   * fields, and the Business Snapshot's "Actual" figure, both use this. */
  async totalRefundedForPeriod(tenantId: string, periodStart: Date, periodEnd: Date): Promise<number> {
    const refunds = await this.listForTenant(tenantId, periodStart, periodEnd);
    return Math.round(refunds.reduce((sum, r) => sum + r.refundAmount, 0) * 100) / 100;
  }
}

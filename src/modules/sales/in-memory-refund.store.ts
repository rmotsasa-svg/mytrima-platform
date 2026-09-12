import { SaleRefund, RefundStore } from "./refund.service";

export class InMemoryRefundStore implements RefundStore {
  private readonly refunds = new Map<string, SaleRefund>();

  async save(refund: SaleRefund): Promise<void> {
    this.refunds.set(refund.id, refund);
  }

  async findAllForSale(tenantId: string, saleId: string): Promise<SaleRefund[]> {
    return [...this.refunds.values()].filter((r) => r.tenantId === tenantId && r.saleId === saleId);
  }

  async findAllForTenant(tenantId: string, periodStart?: Date, periodEnd?: Date): Promise<SaleRefund[]> {
    return [...this.refunds.values()].filter(
      (r) => r.tenantId === tenantId && (!periodStart || r.createdAt >= periodStart) && (!periodEnd || r.createdAt <= periodEnd)
    );
  }
}

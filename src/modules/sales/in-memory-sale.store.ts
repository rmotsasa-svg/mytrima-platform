import { SaleTransaction, SaleStore } from "./sale.service";

export class InMemorySaleStore implements SaleStore {
  private readonly sales = new Map<string, SaleTransaction>();

  async save(transaction: SaleTransaction): Promise<void> {
    this.sales.set(transaction.id, transaction);
  }

  async findAllForTenant(tenantId: string, periodStart?: Date, periodEnd?: Date): Promise<SaleTransaction[]> {
    return [...this.sales.values()].filter(
      (s) => s.tenantId === tenantId && (!periodStart || s.occurredAt >= periodStart) && (!periodEnd || s.occurredAt <= periodEnd)
    );
  }
}

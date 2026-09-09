import { Deal, DealStore } from "./deal.service";

export class InMemoryDealStore implements DealStore {
  private readonly deals = new Map<string, Deal>();

  async save(deal: Deal): Promise<void> {
    this.deals.set(deal.id, deal);
  }

  async findAllForTenant(tenantId: string): Promise<Deal[]> {
    return [...this.deals.values()].filter((d) => d.tenantId === tenantId);
  }

  async findById(tenantId: string, id: string): Promise<Deal | null> {
    const deal = this.deals.get(id);
    return deal && deal.tenantId === tenantId ? deal : null;
  }
}

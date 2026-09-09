import { SalesTarget, SalesTargetStore } from "./sales-target.service";

export class InMemorySalesTargetStore implements SalesTargetStore {
  private readonly targets = new Map<string, SalesTarget>();

  async save(target: SalesTarget): Promise<void> {
    this.targets.set(target.id, target);
  }

  async findAllForTenant(tenantId: string): Promise<SalesTarget[]> {
    return [...this.targets.values()].filter((t) => t.tenantId === tenantId);
  }
}

import { PettyCashTransaction, PettyCashStore } from "./petty-cash.service";

export class InMemoryPettyCashStore implements PettyCashStore {
  private readonly transactions = new Map<string, PettyCashTransaction>();

  async save(transaction: PettyCashTransaction): Promise<void> {
    this.transactions.set(transaction.id, transaction);
  }

  async findAllForTenant(tenantId: string): Promise<PettyCashTransaction[]> {
    return [...this.transactions.values()].filter((t) => t.tenantId === tenantId);
  }
}

import { ShiftBanking, ShiftBankingStore } from "./shift-banking.service";

export class InMemoryShiftBankingStore implements ShiftBankingStore {
  private readonly records = new Map<string, ShiftBanking>();

  async save(record: ShiftBanking): Promise<void> {
    this.records.set(record.id, record);
  }

  async findAllForTenant(tenantId: string): Promise<ShiftBanking[]> {
    return [...this.records.values()].filter((r) => r.tenantId === tenantId);
  }
}

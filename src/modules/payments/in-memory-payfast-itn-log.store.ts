import { PayfastItnLogEntry, PayfastItnLogStore } from "./payfast-itn-log.service";

export class InMemoryPayfastItnLogStore implements PayfastItnLogStore {
  private readonly entries: PayfastItnLogEntry[] = [];

  async save(entry: PayfastItnLogEntry): Promise<void> {
    this.entries.push(entry);
  }

  async findByTenant(tenantId: string): Promise<PayfastItnLogEntry[]> {
    return this.entries.filter((e) => e.tenantId === tenantId);
  }
}

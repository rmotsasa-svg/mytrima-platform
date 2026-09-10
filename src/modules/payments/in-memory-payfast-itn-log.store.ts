import { PayfastItnLogEntry, PayfastItnLogStore } from "./payfast-itn-log.service";

export class InMemoryPayfastItnLogStore implements PayfastItnLogStore {
  private readonly entries: PayfastItnLogEntry[] = [];

  /** Idempotent on (tenantId, pfPaymentId) — mirrors the real Postgres
   * store's `on conflict ... do nothing` (migration 0016). Without
   * DATABASE_URL, this in-memory path is what a real PayFast retry would
   * hit, and it needs the same no-duplicate guarantee, not just a stand-in
   * that happens to work for the happy path. */
  async save(entry: PayfastItnLogEntry): Promise<void> {
    const alreadyLogged = this.entries.some((e) => e.tenantId === entry.tenantId && e.pfPaymentId === entry.pfPaymentId);
    if (alreadyLogged) return;
    this.entries.push(entry);
  }

  async findByTenant(tenantId: string): Promise<PayfastItnLogEntry[]> {
    return this.entries.filter((e) => e.tenantId === tenantId);
  }
}

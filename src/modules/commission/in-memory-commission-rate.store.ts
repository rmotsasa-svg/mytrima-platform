import { CommissionRate, CommissionRateStore } from "./commission.service";

export class InMemoryCommissionRateStore implements CommissionRateStore {
  // Keyed by tenantId:userId, not id — one active rate per staff member,
  // see commission.service.ts's own top comment.
  private readonly rates = new Map<string, CommissionRate>();

  private key(tenantId: string, userId: string): string {
    return `${tenantId}:${userId}`;
  }

  async save(rate: CommissionRate): Promise<void> {
    this.rates.set(this.key(rate.tenantId, rate.userId), rate);
  }

  async findForUser(tenantId: string, userId: string): Promise<CommissionRate | null> {
    return this.rates.get(this.key(tenantId, userId)) ?? null;
  }

  async findAllForTenant(tenantId: string): Promise<CommissionRate[]> {
    return [...this.rates.values()].filter((r) => r.tenantId === tenantId);
  }
}

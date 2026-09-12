import { SubscriptionStore, SubscriptionPaymentStore, TenantSubscription, SubscriptionPayment } from "./billing.service";

/** Same role as every other InMemory* store in this app — what a fresh
 * `npm start` with no DATABASE_URL runs against. Not tenant-isolated by
 * RLS the way the Postgres-backed stores are, same accepted gap every
 * other in-memory fallback here has. */
export class InMemorySubscriptionStore implements SubscriptionStore {
  private readonly byTenant = new Map<string, TenantSubscription>();

  async find(tenantId: string): Promise<TenantSubscription | null> {
    return this.byTenant.get(tenantId) ?? null;
  }

  async save(subscription: TenantSubscription): Promise<void> {
    this.byTenant.set(subscription.tenantId, subscription);
  }
}

export class InMemorySubscriptionPaymentStore implements SubscriptionPaymentStore {
  private readonly payments: SubscriptionPayment[] = [];

  async save(payment: SubscriptionPayment): Promise<void> {
    const idx = this.payments.findIndex((p) => p.id === payment.id);
    if (idx >= 0) this.payments[idx] = payment;
    else this.payments.push(payment);
  }

  async findById(tenantId: string, id: string): Promise<SubscriptionPayment | null> {
    return this.payments.find((p) => p.tenantId === tenantId && p.id === id) ?? null;
  }

  async findByMoPaySessionId(tenantId: string, mopaySessionId: string): Promise<SubscriptionPayment | null> {
    return this.payments.find((p) => p.tenantId === tenantId && p.mopaySessionId === mopaySessionId) ?? null;
  }

  async listForTenant(tenantId: string): Promise<SubscriptionPayment[]> {
    return this.payments.filter((p) => p.tenantId === tenantId).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }
}

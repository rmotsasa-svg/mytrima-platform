import { SubscriptionPayment, SubscriptionPaymentStore } from "./subscription.service";

export class InMemorySubscriptionPaymentStore implements SubscriptionPaymentStore {
  private readonly payments = new Map<string, SubscriptionPayment>();

  async save(payment: SubscriptionPayment): Promise<void> {
    this.payments.set(payment.id, payment);
  }

  async findPendingForTenant(tenantId: string): Promise<SubscriptionPayment | null> {
    return [...this.payments.values()].find((p) => p.tenantId === tenantId && p.status === "pending") ?? null;
  }

  async listForTenant(tenantId: string): Promise<SubscriptionPayment[]> {
    return [...this.payments.values()].filter((p) => p.tenantId === tenantId).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }
}

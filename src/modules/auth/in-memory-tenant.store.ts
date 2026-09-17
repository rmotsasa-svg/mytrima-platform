import { BusinessProfileInput, SubscriptionStatus, SubscriptionTier, TenantRecord, TenantStatus, TenantStore } from "./tenant.service";

/** In-memory mode has no real foreign-key constraint enforcing that a
 * tenant exists before an app_user references it (unlike PgTenantStore's
 * real `tenant` table) — this store exists mainly so registerTenant() has
 * something to call symmetrically with the real store. */
export class InMemoryTenantStore implements TenantStore {
  private readonly tenants = new Map<string, TenantRecord>();

  async create(tenant: TenantRecord): Promise<void> {
    this.tenants.set(tenant.id, tenant);
  }

  async findById(id: string): Promise<TenantRecord | null> {
    const existing = this.tenants.get(id);
    if (!existing) return null;
    // Same real DB defaults as migration 0048 — create() only ever stores
    // {id, name} (see TenantRecord.subscriptionTier's own comment), so a
    // tenant that's never touched subscription state reads back as the
    // same "free/active" a fresh row would in Postgres.
    return { subscriptionTier: "free", subscriptionStatus: "active", status: "pilot", ...existing };
  }

  async updateNotificationPhone(id: string, phoneE164: string): Promise<void> {
    const existing = this.tenants.get(id);
    if (existing) this.tenants.set(id, { ...existing, notificationPhoneE164: phoneE164 });
  }

  async updatePayfastMerchantId(id: string, payfastMerchantId: string): Promise<void> {
    const existing = this.tenants.get(id);
    if (existing) this.tenants.set(id, { ...existing, payfastMerchantId });
  }

  async updateMopayApiKey(id: string, mopayApiKey: string): Promise<void> {
    const existing = this.tenants.get(id);
    if (existing) this.tenants.set(id, { ...existing, mopayApiKey });
  }

  async updateSubscription(id: string, subscription: { tier: SubscriptionTier; status: SubscriptionStatus; nextBillingDate: Date | null }): Promise<void> {
    const existing = this.tenants.get(id);
    if (existing) {
      this.tenants.set(id, {
        ...existing,
        subscriptionTier: subscription.tier,
        subscriptionStatus: subscription.status,
        nextBillingDate: subscription.nextBillingDate ?? undefined,
      });
    }
  }

  async updateBusinessProfile(id: string, profile: BusinessProfileInput): Promise<void> {
    const existing = this.tenants.get(id);
    if (existing) this.tenants.set(id, { ...existing, ...profile });
  }

  async updateStatus(id: string, status: TenantStatus): Promise<void> {
    const existing = this.tenants.get(id);
    if (existing) this.tenants.set(id, { ...existing, status });
  }
}

import { BusinessProfileInput, TenantRecord, TenantStore } from "./tenant.service";

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
    return this.tenants.get(id) ?? null;
  }

  async updateNotificationPhone(id: string, phoneE164: string): Promise<void> {
    const existing = this.tenants.get(id);
    if (existing) this.tenants.set(id, { ...existing, notificationPhoneE164: phoneE164 });
  }

  async updatePayfastMerchantId(id: string, payfastMerchantId: string): Promise<void> {
    const existing = this.tenants.get(id);
    if (existing) this.tenants.set(id, { ...existing, payfastMerchantId });
  }

  async updateBusinessProfile(id: string, profile: BusinessProfileInput): Promise<void> {
    const existing = this.tenants.get(id);
    if (existing) this.tenants.set(id, { ...existing, ...profile });
  }
}

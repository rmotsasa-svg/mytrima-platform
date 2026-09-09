import { TenantRecord, TenantStore } from "./tenant.service";

/** In-memory mode has no real foreign-key constraint enforcing that a
 * tenant exists before an app_user references it (unlike PgTenantStore's
 * real `tenant` table) — this store exists mainly so registerTenant() has
 * something to call symmetrically with the real store. */
export class InMemoryTenantStore implements TenantStore {
  private readonly tenants = new Set<string>();

  async create(tenant: TenantRecord): Promise<void> {
    this.tenants.add(tenant.id);
  }
}

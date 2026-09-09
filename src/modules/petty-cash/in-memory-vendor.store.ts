import { Vendor, VendorStore } from "./vendor.service";

export class InMemoryVendorStore implements VendorStore {
  private readonly vendors = new Map<string, Vendor>();

  async save(vendor: Vendor): Promise<void> {
    this.vendors.set(vendor.id, vendor);
  }

  async findAllForTenant(tenantId: string): Promise<Vendor[]> {
    return [...this.vendors.values()].filter((v) => v.tenantId === tenantId);
  }

  async findById(tenantId: string, id: string): Promise<Vendor | null> {
    const vendor = this.vendors.get(id);
    return vendor && vendor.tenantId === tenantId ? vendor : null;
  }
}

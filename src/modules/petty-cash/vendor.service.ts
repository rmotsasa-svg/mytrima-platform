import { Inject, Injectable } from "@nestjs/common";
import { VENDOR_STORE } from "./petty-cash.tokens";

/** Master Plan Addendum v1.3, Section G: a tenant's own maintained supplier
 * list — a payment in the petty cash ledger optionally names one. */

export interface Vendor {
  id: string;
  tenantId: string;
  name: string;
  contactInfo?: string;
  isActive: boolean;
  createdAt: Date;
}

export class InvalidVendorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidVendorError";
  }
}

export interface VendorStore {
  save(vendor: Vendor): Promise<void>;
  findAllForTenant(tenantId: string): Promise<Vendor[]>;
  findById(tenantId: string, id: string): Promise<Vendor | null>;
}

@Injectable()
export class VendorService {
  constructor(@Inject(VENDOR_STORE) private readonly store: VendorStore) {}

  async create(tenantId: string, id: string, name: string, contactInfo?: string): Promise<Vendor> {
    if (!name.trim()) throw new InvalidVendorError("name is required");
    const vendor: Vendor = { id, tenantId, name: name.trim(), contactInfo: contactInfo?.trim() || undefined, isActive: true, createdAt: new Date() };
    await this.store.save(vendor);
    return vendor;
  }

  async listForTenant(tenantId: string): Promise<Vendor[]> {
    return this.store.findAllForTenant(tenantId);
  }

  async findById(tenantId: string, id: string): Promise<Vendor | null> {
    return this.store.findById(tenantId, id);
  }
}

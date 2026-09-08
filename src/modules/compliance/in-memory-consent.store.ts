import { Injectable } from "@nestjs/common";
import { ConsentStore, ConsentRecord } from "./consent.service";

/**
 * KNOWN GAP: in-memory only — state is lost on process restart and never
 * shared across app instances. This exists so the NestJS app has a real,
 * runnable ConsentStore today; replace with a Postgres-backed implementation
 * of the same ConsentStore interface (see the consent_record table in
 * db/migrations/0001_tenant_and_rls.sql) once a live database exists.
 * ConsentService depends only on the ConsentStore interface, so nothing else
 * needs to change when that swap happens.
 */
@Injectable()
export class InMemoryConsentStore implements ConsentStore {
  private records = new Map<string, ConsentRecord>();

  async save(record: ConsentRecord): Promise<void> {
    this.records.set(record.id, record);
  }

  async findActive(tenantId: string, customerId: string, dataCategory: string): Promise<ConsentRecord | null> {
    for (const r of this.records.values()) {
      if (r.tenantId === tenantId && r.customerId === customerId && r.dataCategory === dataCategory && !r.revokedAt) {
        return r;
      }
    }
    return null;
  }

  async findAllForCustomer(tenantId: string, customerId: string): Promise<ConsentRecord[]> {
    return [...this.records.values()].filter((r) => r.tenantId === tenantId && r.customerId === customerId);
  }

  async revoke(tenantId: string, id: string, revokedAt: Date): Promise<void> {
    const r = this.records.get(id);
    if (r && r.tenantId === tenantId) r.revokedAt = revokedAt;
  }
}

import { Injectable } from "@nestjs/common";
import { CustomerStore, Customer } from "./customer.service";

/**
 * KNOWN GAP: in-memory only, same caveat as every other InMemory*Store in
 * this scaffold — replace with the real Postgres-backed implementation
 * (PgCustomerStore, against the `customer` table from db/migrations/0001)
 * once a live database exists, which CustomerModule already does via
 * DATABASE_URL — see customer.module.ts.
 */
@Injectable()
export class InMemoryCustomerStore implements CustomerStore {
  private customers = new Map<string, Customer>();

  async save(customer: Customer): Promise<void> {
    this.customers.set(customer.id, customer);
  }

  async findAllForTenant(tenantId: string): Promise<Customer[]> {
    return [...this.customers.values()].filter((c) => c.tenantId === tenantId);
  }

  async findById(tenantId: string, id: string): Promise<Customer | null> {
    const c = this.customers.get(id);
    return c && c.tenantId === tenantId ? c : null;
  }
}

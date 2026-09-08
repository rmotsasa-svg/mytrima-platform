import { Injectable } from "@nestjs/common";
import { GrowthAuditResponseStore, GrowthAuditResponse } from "./growth-audit.service";

/**
 * KNOWN GAP: in-memory only, same caveat as every other InMemory*Store in
 * this scaffold — replaced with the real Postgres-backed implementation
 * (PgGrowthAuditResponseStore, against the `growth_audit_response` table
 * from db/migrations/0001) once a live database exists, which
 * GrowthAuditModule already does via DATABASE_URL — see growth-audit.module.ts.
 */
@Injectable()
export class InMemoryGrowthAuditResponseStore implements GrowthAuditResponseStore {
  private responses = new Map<string, GrowthAuditResponse>();

  async save(response: GrowthAuditResponse): Promise<void> {
    this.responses.set(response.id, response);
  }

  async findAllForTenant(tenantId: string): Promise<GrowthAuditResponse[]> {
    return [...this.responses.values()].filter((r) => r.tenantId === tenantId);
  }
}

import { Injectable } from "@nestjs/common";
import { NpsResponseStore, StoredNpsResponse } from "./nps.service";

/**
 * KNOWN GAP: in-memory only, same caveat as every other InMemory*Store in
 * this scaffold — replaced with the real Postgres-backed implementation
 * (PgNpsResponseStore, against the `nps_response` table from
 * db/migrations/0006) once a live database exists, which NpsModule already
 * does via DATABASE_URL — see nps.module.ts.
 */
@Injectable()
export class InMemoryNpsResponseStore implements NpsResponseStore {
  private responses = new Map<string, StoredNpsResponse>();

  async save(response: StoredNpsResponse): Promise<void> {
    this.responses.set(response.id, response);
  }

  async findAllForTenant(tenantId: string): Promise<StoredNpsResponse[]> {
    return [...this.responses.values()].filter((r) => r.tenantId === tenantId);
  }
}

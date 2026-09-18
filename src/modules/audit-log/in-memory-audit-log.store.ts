import { AuditLogEntry, AuditLogStore } from "./audit-log.service";

/** In-memory mode has no per-tenant RLS to work around at all (see
 * pg-audit-log.store.ts's own top comment on the real constraint that
 * store deals with) — this store exists purely for tests and a
 * no-DATABASE_URL dev environment, same reasoning as every other
 * InMemory* store in this codebase. */
export class InMemoryAuditLogStore implements AuditLogStore {
  private readonly entries: AuditLogEntry[] = [];
  private nextId = 1;

  async record(entry: Omit<AuditLogEntry, "id" | "occurredAt">): Promise<void> {
    this.entries.push({ ...entry, id: String(this.nextId++), occurredAt: new Date() });
  }

  // Reverse (real insertion order, not a timestamp sort) rather than
  // sort by occurredAt: two records() calls in quick succession can
  // genuinely share the same millisecond, and Array#sort's stability
  // would then silently keep them in ORIGINAL (oldest-first) order —
  // the exact opposite of "most recent first." Insertion order is
  // always a real, unambiguous tie-break; a wall-clock timestamp isn't.
  async listForTenant(tenantId: string): Promise<AuditLogEntry[]> {
    return this.entries.filter((e) => e.tenantId === tenantId).reverse();
  }

  async listPlatformLevel(): Promise<AuditLogEntry[]> {
    return this.entries.filter((e) => e.tenantId === null).reverse();
  }
}

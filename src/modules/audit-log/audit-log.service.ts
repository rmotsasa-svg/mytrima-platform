import { Inject, Injectable } from "@nestjs/common";
import { AUDIT_LOG_STORE } from "./audit-log.tokens";

/**
 * Closes a real, long-standing gap: `audit_log` (db/migrations/0001,
 * RLS added in 0023) has existed in the schema since this project's very
 * first migration and has never been written to or read from by any
 * application code — confirmed directly against a real platform-admin
 * architecture review's own requirement (a per-tenant "Audit Log" tab,
 * plus platform-level events like admin creation).
 *
 * Tenant STAFF actions already have their own real log — see
 * auth/staff-activity.service.ts — this is the platform-OPERATOR half
 * that never existed: every admin action against a specific tenant
 * (suspend, a subscription override, a custom price) now writes a real
 * row here, tenant_id set to that real tenant.
 *
 * REAL RLS CONSTRAINT this design works WITH, not around: migration
 * 0023's actual policy filters non-null tenant_id rows against
 * `app.current_tenant_id` exactly like every other tenant-scoped table
 * (that migration's own comment flags this as a real asymmetry against
 * 0001's original "platform admins need cross-tenant visibility" intent,
 * needing a security-advisor review — not solved here). Writing/reading
 * a tenant-scoped row therefore goes through runWithTenantContext, same
 * as tenant_subscription_payment's own store — this service can log and
 * read back any ONE tenant's admin-audit trail for real, but a single
 * flat cross-tenant feed over tenant-scoped rows isn't built here (it
 * would need the same root-registry-enumeration PilotSummaryService
 * already uses, which itself needs a real Postgres pool). Platform-level
 * events (tenant_id null — e.g. admin creation) have no such constraint
 * and are listed directly.
 *
 * `actorUserId` (a real FK to app_user) stays null for every admin-
 * caused event recorded here: an admin is a row in `admin_user`, a
 * completely separate table (Phase 1 of the admin-platform plan) that
 * this column was never designed to reference. The acting admin's id
 * goes in `metadata.actorAdminId` instead — real and complete, just not
 * a second FK column this table doesn't have.
 */

export interface AuditLogEntry {
  id: string;
  tenantId: string | null;
  actorUserId: string | null;
  action: string;
  entityTable: string;
  entityId: string | null;
  occurredAt: Date;
  metadata: Record<string, unknown> | null;
}

export interface AuditLogStore {
  record(entry: Omit<AuditLogEntry, "id" | "occurredAt">): Promise<void>;
  listForTenant(tenantId: string): Promise<AuditLogEntry[]>;
  /** Only ever tenant_id IS NULL rows — see this file's own top comment
   * on the real RLS constraint a flat cross-tenant feed over
   * tenant-scoped rows would need to work around, not solved here. */
  listPlatformLevel(): Promise<AuditLogEntry[]>;
}

@Injectable()
export class AuditLogService {
  constructor(@Inject(AUDIT_LOG_STORE) private readonly store: AuditLogStore) {}

  /** The one real write path — every admin action funnels through this,
   * same "one real mapping, not something each caller could reinvent
   * slightly differently" discipline as TenantService.setSubscription()'s
   * own comment. `tenantId: null` means a genuine platform-level event
   * (e.g. admin creation); a real tenant id means this admin action
   * targeted that one tenant specifically. */
  async recordAdminAction(action: string, entityTable: string, entityId: string | null, actorAdminId: string, tenantId: string | null = null): Promise<void> {
    await this.store.record({ tenantId, actorUserId: null, action, entityTable, entityId, metadata: { actorAdminId } });
  }

  async listForTenant(tenantId: string): Promise<AuditLogEntry[]> {
    return this.store.listForTenant(tenantId);
  }

  async listPlatformLevel(): Promise<AuditLogEntry[]> {
    return this.store.listPlatformLevel();
  }
}

import { Pool } from "pg";
import { SupportTicket, SupportTicketStore, SupportTicketSeverity, SupportTicketStatus } from "./support-ticket.service";
import { runWithTenantContext } from "../../common/postgres";

interface SupportTicketRow {
  id: string;
  tenant_id: string;
  created_by_user_id: string;
  subject: string;
  description: string;
  severity: SupportTicketSeverity;
  status: SupportTicketStatus;
  resolution_notes: string | null;
  created_at: Date;
  updated_at: Date;
}

function rowToTicket(row: SupportTicketRow): SupportTicket {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    createdByUserId: row.created_by_user_id,
    subject: row.subject,
    description: row.description,
    severity: row.severity,
    status: row.status,
    resolutionNotes: row.resolution_notes ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Real Postgres-backed SupportTicketStore, against `support_ticket`
 * (db/migrations/0021_support_ticket.sql). Same runWithTenantContext
 * pattern as every other real store here — the status-transition UPDATE
 * (via save()'s upsert) runs inside it just like the initial INSERT, per
 * this project's own RLS-tenant-context lesson (recommendation.service.ts's
 * markDetected() comment). */
export class PgSupportTicketStore implements SupportTicketStore {
  constructor(private readonly pool: Pool) {}

  async save(ticket: SupportTicket): Promise<void> {
    await runWithTenantContext(this.pool, ticket.tenantId, (client) =>
      client.query(
        `insert into support_ticket (id, tenant_id, created_by_user_id, subject, description, severity, status, resolution_notes, updated_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         on conflict (id) do update set
           status = excluded.status, resolution_notes = excluded.resolution_notes, updated_at = excluded.updated_at`,
        [
          ticket.id,
          ticket.tenantId,
          ticket.createdByUserId,
          ticket.subject,
          ticket.description,
          ticket.severity,
          ticket.status,
          ticket.resolutionNotes ?? null,
          ticket.updatedAt,
        ]
      )
    );
  }

  async findAllForTenant(tenantId: string): Promise<SupportTicket[]> {
    const result = await runWithTenantContext(this.pool, tenantId, (client) =>
      client.query<SupportTicketRow>(`select * from support_ticket where tenant_id = $1 order by created_at desc`, [tenantId])
    );
    return result.rows.map(rowToTicket);
  }

  async findById(tenantId: string, id: string): Promise<SupportTicket | null> {
    const result = await runWithTenantContext(this.pool, tenantId, (client) =>
      client.query<SupportTicketRow>(`select * from support_ticket where id = $1`, [id])
    );
    return result.rows[0] ? rowToTicket(result.rows[0]) : null;
  }
}

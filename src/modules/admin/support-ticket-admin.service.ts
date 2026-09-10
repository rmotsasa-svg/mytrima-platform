import { Inject, Injectable } from "@nestjs/common";
import { Pool } from "pg";
import { PG_POOL } from "../../common/database.module";
import { SupportTicketService, SupportTicket } from "../support/support-ticket.service";

/**
 * The operator's cross-tenant view over every tenant's support tickets —
 * same reasoning and same pattern as pilot-summary.service.ts: `tenant`
 * itself carries no RLS (it's the root registry), so listing every tenant
 * id directly and then reusing SupportTicketService.listForTenant() per
 * tenant (which itself runs inside runWithTenantContext) is the
 * established way to build a real cross-tenant view without a Postgres
 * role that bypasses RLS, which this deployment doesn't have.
 *
 * Same DATABASE_URL-gated fallback as pilot-summary.service.ts: without a
 * real Postgres pool there is no in-memory tenant registry to enumerate,
 * so this returns an empty list rather than guessing.
 */
export interface SupportTicketWithTenant extends SupportTicket {
  tenantName: string;
}

@Injectable()
export class SupportTicketAdminService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool | null,
    private readonly supportTicketService: SupportTicketService
  ) {}

  async listAcrossTenants(): Promise<SupportTicketWithTenant[]> {
    if (!this.pool) return [];

    const result = await this.pool.query<{ id: string; name: string }>("select id, name from tenant order by created_at asc");
    const perTenant = await Promise.all(
      result.rows.map(async (row) => {
        const tickets = await this.supportTicketService.listForTenant(row.id);
        return tickets.map((t) => ({ ...t, tenantName: row.name }));
      })
    );
    return perTenant.flat().sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async markInProgress(tenantId: string, ticketId: string) {
    return this.supportTicketService.markInProgress(tenantId, ticketId);
  }

  async resolve(tenantId: string, ticketId: string, resolutionNotes: string) {
    return this.supportTicketService.resolve(tenantId, ticketId, resolutionNotes);
  }
}

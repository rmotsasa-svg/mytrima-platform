import { Pool } from "pg";
import { Lead, LeadStage, LeadStore } from "./crm.service";
import { runWithTenantContext } from "../../common/postgres";

interface LeadRow {
  id: string;
  tenant_id: string;
  name: string;
  contact_phone: string | null;
  contact_email: string | null;
  source: string;
  stage: string;
  estimated_value: string | null;
  owner_user_id: string | null;
  created_at: Date;
  last_activity_at: Date;
  won_customer_id: string | null;
}

function rowToLead(row: LeadRow): Lead {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    name: row.name,
    contactPhone: row.contact_phone ?? undefined,
    contactEmail: row.contact_email ?? undefined,
    source: row.source,
    stage: row.stage as LeadStage,
    estimatedValue: row.estimated_value !== null ? Number(row.estimated_value) : undefined,
    ownerUserId: row.owner_user_id ?? undefined,
    createdAt: row.created_at,
    lastActivityAt: row.last_activity_at,
    wonCustomerId: row.won_customer_id ?? undefined,
  };
}

/** Real Postgres-backed LeadStore, against `lead`
 * (db/migrations/0037_crm.sql). */
export class PgLeadStore implements LeadStore {
  constructor(private readonly pool: Pool) {}

  async save(lead: Lead): Promise<void> {
    await runWithTenantContext(this.pool, lead.tenantId, (client) =>
      client.query(
        `insert into lead
           (id, tenant_id, name, contact_phone, contact_email, source, stage, estimated_value, owner_user_id, created_at, last_activity_at, won_customer_id)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         on conflict (id) do update set
           name              = excluded.name,
           contact_phone     = excluded.contact_phone,
           contact_email     = excluded.contact_email,
           source            = excluded.source,
           stage             = excluded.stage,
           estimated_value   = excluded.estimated_value,
           owner_user_id     = excluded.owner_user_id,
           last_activity_at  = excluded.last_activity_at,
           won_customer_id   = excluded.won_customer_id`,
        [
          lead.id,
          lead.tenantId,
          lead.name,
          lead.contactPhone ?? null,
          lead.contactEmail ?? null,
          lead.source,
          lead.stage,
          lead.estimatedValue ?? null,
          lead.ownerUserId ?? null,
          lead.createdAt,
          lead.lastActivityAt,
          lead.wonCustomerId ?? null,
        ]
      )
    );
  }

  async findAllForTenant(tenantId: string): Promise<Lead[]> {
    const result = await runWithTenantContext(this.pool, tenantId, (client) =>
      client.query<LeadRow>(`select * from lead where tenant_id = $1 order by last_activity_at desc`, [tenantId])
    );
    return result.rows.map(rowToLead);
  }

  async findById(tenantId: string, id: string): Promise<Lead | null> {
    const result = await runWithTenantContext(this.pool, tenantId, (client) =>
      client.query<LeadRow>(`select * from lead where tenant_id = $1 and id = $2`, [tenantId, id])
    );
    return result.rows[0] ? rowToLead(result.rows[0]) : null;
  }
}

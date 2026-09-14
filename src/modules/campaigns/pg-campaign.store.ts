import { Pool } from "pg";
import { Campaign, CampaignStore, CampaignChannel, CampaignLaunchResult } from "./campaign.service";
import { runWithTenantContext } from "../../common/postgres";

interface CampaignRow {
  id: string;
  tenant_id: string;
  name: string;
  deal_id: string | null;
  message: string | null;
  channels: CampaignChannel[];
  last_launched_at: Date | null;
  last_launch_results: CampaignLaunchResult[] | null;
  created_at: Date;
}

function rowToCampaign(row: CampaignRow): Campaign {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    name: row.name,
    dealId: row.deal_id ?? undefined,
    message: row.message ?? undefined,
    channels: row.channels,
    lastLaunchedAt: row.last_launched_at ?? undefined,
    lastLaunchResults: row.last_launch_results ?? undefined,
    createdAt: row.created_at,
  };
}

/** Real Postgres-backed CampaignStore, against `campaign`
 * (db/migrations/0032_campaigns.sql). */
export class PgCampaignStore implements CampaignStore {
  constructor(private readonly pool: Pool) {}

  async save(campaign: Campaign): Promise<void> {
    await runWithTenantContext(this.pool, campaign.tenantId, (client) =>
      client.query(
        `insert into campaign (id, tenant_id, name, deal_id, message, channels, last_launched_at, last_launch_results)
         values ($1, $2, $3, $4, $5, $6, $7, $8)
         on conflict (id) do update set
           name = excluded.name,
           deal_id = excluded.deal_id,
           message = excluded.message,
           channels = excluded.channels,
           last_launched_at = excluded.last_launched_at,
           last_launch_results = excluded.last_launch_results`,
        [
          campaign.id,
          campaign.tenantId,
          campaign.name,
          campaign.dealId ?? null,
          campaign.message ?? null,
          campaign.channels,
          campaign.lastLaunchedAt ?? null,
          campaign.lastLaunchResults ? JSON.stringify(campaign.lastLaunchResults) : null,
        ]
      )
    );
  }

  async findAllForTenant(tenantId: string): Promise<Campaign[]> {
    const result = await runWithTenantContext(this.pool, tenantId, (client) =>
      client.query<CampaignRow>(`select * from campaign where tenant_id = $1 order by created_at desc`, [tenantId])
    );
    return result.rows.map(rowToCampaign);
  }

  async findById(tenantId: string, id: string): Promise<Campaign | null> {
    const result = await runWithTenantContext(this.pool, tenantId, (client) =>
      client.query<CampaignRow>(`select * from campaign where tenant_id = $1 and id = $2`, [tenantId, id])
    );
    return result.rows[0] ? rowToCampaign(result.rows[0]) : null;
  }
}

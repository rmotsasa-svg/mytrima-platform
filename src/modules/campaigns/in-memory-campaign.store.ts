import { Campaign, CampaignStore } from "./campaign.service";

export class InMemoryCampaignStore implements CampaignStore {
  private readonly campaigns = new Map<string, Campaign>();

  async save(campaign: Campaign): Promise<void> {
    this.campaigns.set(campaign.id, campaign);
  }

  async findAllForTenant(tenantId: string): Promise<Campaign[]> {
    return [...this.campaigns.values()].filter((c) => c.tenantId === tenantId);
  }

  async findById(tenantId: string, id: string): Promise<Campaign | null> {
    const campaign = this.campaigns.get(id);
    return campaign && campaign.tenantId === tenantId ? campaign : null;
  }
}

import { CrmActivity, CrmActivityStore } from "./crm.service";

export class InMemoryCrmActivityStore implements CrmActivityStore {
  private readonly activities: CrmActivity[] = [];

  async save(activity: CrmActivity): Promise<void> {
    this.activities.push(activity);
  }

  async findAllForLead(tenantId: string, leadId: string): Promise<CrmActivity[]> {
    return this.activities
      .filter((a) => a.tenantId === tenantId && a.leadId === leadId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }
}

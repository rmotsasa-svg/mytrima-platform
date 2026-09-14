import { Lead, LeadStore } from "./crm.service";

export class InMemoryLeadStore implements LeadStore {
  private readonly leads = new Map<string, Lead>();

  async save(lead: Lead): Promise<void> {
    this.leads.set(lead.id, lead);
  }

  async findAllForTenant(tenantId: string): Promise<Lead[]> {
    return [...this.leads.values()].filter((l) => l.tenantId === tenantId);
  }

  async findById(tenantId: string, id: string): Promise<Lead | null> {
    const lead = this.leads.get(id);
    return lead && lead.tenantId === tenantId ? lead : null;
  }
}

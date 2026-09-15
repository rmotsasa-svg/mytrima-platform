import { Quotation, QuotationStore } from "./quotation.service";

export class InMemoryQuotationStore implements QuotationStore {
  private readonly quotations = new Map<string, Quotation>();

  async save(quotation: Quotation): Promise<void> {
    this.quotations.set(quotation.id, quotation);
  }

  async findAllForTenant(tenantId: string): Promise<Quotation[]> {
    return [...this.quotations.values()].filter((q) => q.tenantId === tenantId);
  }

  async findById(tenantId: string, id: string): Promise<Quotation | null> {
    const quotation = this.quotations.get(id);
    return quotation && quotation.tenantId === tenantId ? quotation : null;
  }
}

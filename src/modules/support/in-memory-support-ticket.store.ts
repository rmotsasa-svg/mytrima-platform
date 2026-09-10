import { SupportTicket, SupportTicketStore } from "./support-ticket.service";

export class InMemorySupportTicketStore implements SupportTicketStore {
  private readonly tickets = new Map<string, SupportTicket>();

  async save(ticket: SupportTicket): Promise<void> {
    this.tickets.set(ticket.id, ticket);
  }

  async findAllForTenant(tenantId: string): Promise<SupportTicket[]> {
    return [...this.tickets.values()].filter((t) => t.tenantId === tenantId).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async findById(tenantId: string, id: string): Promise<SupportTicket | null> {
    const ticket = this.tickets.get(id);
    return ticket && ticket.tenantId === tenantId ? ticket : null;
  }
}

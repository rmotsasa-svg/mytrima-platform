import { Trigger, TriggerStatus, TriggerStore } from "./trigger.service";

export class InMemoryTriggerStore implements TriggerStore {
  private readonly triggers = new Map<string, Trigger>();

  async save(trigger: Trigger): Promise<void> {
    this.triggers.set(trigger.id, trigger);
  }

  async findAllForTenant(tenantId: string, status?: TriggerStatus): Promise<Trigger[]> {
    return [...this.triggers.values()]
      .filter((t) => t.tenantId === tenantId && (status === undefined || t.status === status))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async findById(tenantId: string, id: string): Promise<Trigger | null> {
    const trigger = this.triggers.get(id);
    return trigger && trigger.tenantId === tenantId ? trigger : null;
  }
}

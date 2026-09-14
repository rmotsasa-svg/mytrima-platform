import { GrowthAction, GrowthActionStatus, GrowthActionStore } from "./growth-action.service";

export class InMemoryGrowthActionStore implements GrowthActionStore {
  private readonly actions = new Map<string, GrowthAction>();

  async save(action: GrowthAction): Promise<void> {
    this.actions.set(action.id, action);
  }

  async findAllForTenant(tenantId: string, status?: GrowthActionStatus): Promise<GrowthAction[]> {
    return [...this.actions.values()]
      .filter((a) => a.tenantId === tenantId && (status === undefined || a.status === status))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async findById(tenantId: string, id: string): Promise<GrowthAction | null> {
    const action = this.actions.get(id);
    return action && action.tenantId === tenantId ? action : null;
  }
}

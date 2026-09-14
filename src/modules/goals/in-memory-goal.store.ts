import { Goal, GoalStore } from "./goal.service";

export class InMemoryGoalStore implements GoalStore {
  private readonly goals = new Map<string, Goal>();

  async save(goal: Goal): Promise<void> {
    this.goals.set(goal.id, goal);
  }

  async findAllForTenant(tenantId: string): Promise<Goal[]> {
    return [...this.goals.values()].filter((g) => g.tenantId === tenantId).sort((a, b) => a.deadline.getTime() - b.deadline.getTime());
  }

  async findById(tenantId: string, id: string): Promise<Goal | null> {
    const goal = this.goals.get(id);
    return goal && goal.tenantId === tenantId ? goal : null;
  }
}

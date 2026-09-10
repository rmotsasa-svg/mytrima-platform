import { RecommendationLogEntry, RecommendationStore } from "./recommendation.service";

export class InMemoryRecommendationStore implements RecommendationStore {
  private readonly entries = new Map<string, RecommendationLogEntry>();

  async save(entry: RecommendationLogEntry): Promise<void> {
    this.entries.set(entry.id, entry);
  }

  async findAllForTenant(tenantId: string): Promise<RecommendationLogEntry[]> {
    return [...this.entries.values()].filter((e) => e.tenantId === tenantId);
  }

  async markDetected(tenantId: string, id: string, detectedAt: Date): Promise<void> {
    const existing = this.entries.get(id);
    if (existing && existing.tenantId === tenantId) this.entries.set(id, { ...existing, actionDetectedAt: detectedAt });
  }
}

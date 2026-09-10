import { SocialPostLogEntry, SocialPostLogStore } from "./social-post-log.service";

export class InMemorySocialPostLogStore implements SocialPostLogStore {
  private readonly entries: SocialPostLogEntry[] = [];

  async save(entry: SocialPostLogEntry): Promise<void> {
    this.entries.push(entry);
  }

  async findRecentForTenant(tenantId: string, sinceDate: Date): Promise<SocialPostLogEntry[]> {
    return this.entries.filter((e) => e.tenantId === tenantId && e.postedAt >= sinceDate);
  }
}

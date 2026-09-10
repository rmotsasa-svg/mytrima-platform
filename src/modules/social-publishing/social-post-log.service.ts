import { Inject, Injectable } from "@nestjs/common";
import { SOCIAL_POST_LOG_STORE } from "./social-publishing.tokens";

/** See migration 0017's own comment for why this exists: nothing else
 * persists Mytrima's own record of "did this tenant post recently" —
 * MetaGraphSocialService calls the real Graph API live but never logs
 * history locally, which the Growth Audit recommendation engine's Section F
 * signal needs. */
export interface SocialPostLogEntry {
  id: string;
  tenantId: string;
  provider: "facebook" | "instagram";
  postId: string;
  postedAt: Date;
}

export interface SocialPostLogStore {
  save(entry: SocialPostLogEntry): Promise<void>;
  findRecentForTenant(tenantId: string, sinceDate: Date): Promise<SocialPostLogEntry[]>;
}

@Injectable()
export class SocialPostLogService {
  constructor(@Inject(SOCIAL_POST_LOG_STORE) private readonly store: SocialPostLogStore) {}

  async record(entry: SocialPostLogEntry): Promise<void> {
    await this.store.save(entry);
  }

  /** Has this tenant posted at all within the last `days` days? — the real
   * signal Growth Audit Section F's "content or posting schedule" question
   * needs, in place of a self-reported answer. */
  async hasPostedRecently(tenantId: string, days: number): Promise<boolean> {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const recent = await this.store.findRecentForTenant(tenantId, since);
    return recent.length > 0;
  }
}

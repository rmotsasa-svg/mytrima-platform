import { WebsiteVisit, WebsiteVisitStore } from "./website-visit.service";

/** Same role as every other InMemory* store in this app — what a fresh
 * `npm start` with no DATABASE_URL runs against, so the dashboard and
 * this feature both work with zero configuration. Not tenant-isolated by
 * RLS the way PgWebsiteVisitStore is (see analytics.module.ts's own
 * comment on why that gap is acceptable here, same reasoning as every
 * other in-memory fallback store in this codebase). */
export class InMemoryWebsiteVisitStore implements WebsiteVisitStore {
  private readonly visits: WebsiteVisit[] = [];

  async save(visit: WebsiteVisit): Promise<void> {
    this.visits.push(visit);
  }

  async findAllForTenant(tenantId: string, periodStart: Date, periodEnd: Date): Promise<WebsiteVisit[]> {
    return this.visits.filter(
      (v) => v.tenantId === tenantId && v.occurredAt >= periodStart && v.occurredAt <= periodEnd
    );
  }
}

import { Inject, Injectable } from "@nestjs/common";
import { WEBSITE_VISIT_STORE } from "./analytics.tokens";

export type DeviceType = "desktop" | "mobile" | "tablet" | "other";

/**
 * REAL GAP the tenant asked about directly ("we did not build a module
 * that will help connect tenants website and monitor, report analytic")
 * — closed 2026-09-11, migration 0025. Between the two real ways to build
 * this (connect to a tenant's existing Google Analytics vs. a first-party
 * collector Mytrima owns), the tenant chose the first-party collector —
 * the only option that works for a tenant with no analytics already set
 * up, the more likely case for this pilot's own cohort.
 *
 * That choice carries a real privacy weight the other option wouldn't:
 * this module holds behavioral data about a tenant's own SITE VISITORS,
 * people with no account and no relationship with Mytrima. See migration
 * 0025's own top comment for the full reasoning; this file's own job is
 * just the one piece of that reasoning that lives in code rather than SQL:
 * classifyDeviceType() below is the ONLY thing ever done with a real
 * User-Agent header — the raw string itself never reaches a store.
 */
export interface WebsiteVisit {
  id: string;
  tenantId: string;
  sessionId: string;
  path: string;
  referrer?: string;
  country?: string;
  deviceType: DeviceType;
  occurredAt: Date;
}

export interface RecordVisitInput {
  id: string;
  tenantId: string;
  sessionId: string;
  path: string;
  referrer?: string;
  /** The real Request User-Agent header — used only by classifyDeviceType()
   * below, in this same request, then discarded. Never forwarded to
   * WebsiteVisitStore.save(), never logged. */
  userAgent?: string;
  /** A two-letter country code, already resolved by a trusted edge/proxy
   * (see AnalyticsController.readCountry()) — never derived from a raw IP
   * this app looked at itself. undefined when no such header is present. */
  country?: string;
}

export interface WebsiteVisitStore {
  save(visit: WebsiteVisit): Promise<void>;
  findAllForTenant(tenantId: string, periodStart: Date, periodEnd: Date): Promise<WebsiteVisit[]>;
}

export class InvalidVisitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidVisitError";
  }
}

export interface AnalyticsSummary {
  periodStart: Date;
  periodEnd: Date;
  totalVisits: number;
  uniqueSessions: number;
  topPaths: { path: string; count: number }[];
  topReferrers: { referrer: string; count: number }[];
  deviceBreakdown: Record<DeviceType, number>;
  visitsByDay: { date: string; count: number }[];
}

/**
 * Classifies a real User-Agent header into a coarse device category — a
 * real, if deliberately simple, heuristic (the same substring checks any
 * lightweight UA sniffer in production use relies on), not a fabricated
 * signal. Intentionally coarse: three buckets plus "other" is enough to
 * answer "are my customers mostly on their phones" without keeping
 * anything close to the raw string, which is a real (if minor)
 * fingerprinting surface on its own — see migration 0025's own comment on
 * why the raw header is never persisted.
 */
export function classifyDeviceType(userAgent: string | undefined): DeviceType {
  if (!userAgent) return "other";
  if (/ipad|tablet/i.test(userAgent)) return "tablet";
  if (/mobi|android|iphone/i.test(userAgent)) return "mobile";
  if (/mozilla|chrome|safari|firefox|edge/i.test(userAgent)) return "desktop";
  return "other";
}

/**
 * Pure — given a real set of visits already fetched for the period,
 * compute the summary. Kept separate from AnalyticsService.getSummary()
 * so this is unit-testable against hand-built fixtures with no store
 * constructed at all, same discipline scoreAudit()/computeOnboardingStatus()
 * already established in this codebase.
 */
export function computeAnalyticsSummary(visits: WebsiteVisit[], period: { start: Date; end: Date }): AnalyticsSummary {
  const pathCounts = new Map<string, number>();
  const referrerCounts = new Map<string, number>();
  const dayCounts = new Map<string, number>();
  const sessionIds = new Set<string>();
  const deviceBreakdown: Record<DeviceType, number> = { desktop: 0, mobile: 0, tablet: 0, other: 0 };

  for (const visit of visits) {
    pathCounts.set(visit.path, (pathCounts.get(visit.path) ?? 0) + 1);
    const referrerLabel = visit.referrer && visit.referrer.trim().length > 0 ? visit.referrer : "Direct";
    referrerCounts.set(referrerLabel, (referrerCounts.get(referrerLabel) ?? 0) + 1);
    const day = visit.occurredAt.toISOString().slice(0, 10);
    dayCounts.set(day, (dayCounts.get(day) ?? 0) + 1);
    sessionIds.add(visit.sessionId);
    deviceBreakdown[visit.deviceType] += 1;
  }

  const topEntries = (counts: Map<string, number>, limit: number) =>
    [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);

  return {
    periodStart: period.start,
    periodEnd: period.end,
    totalVisits: visits.length,
    uniqueSessions: sessionIds.size,
    topPaths: topEntries(pathCounts, 10).map(([path, count]) => ({ path, count })),
    topReferrers: topEntries(referrerCounts, 10).map(([referrer, count]) => ({ referrer, count })),
    deviceBreakdown,
    visitsByDay: [...dayCounts.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, count]) => ({ date, count })),
  };
}

@Injectable()
export class AnalyticsService {
  constructor(@Inject(WEBSITE_VISIT_STORE) private readonly store: WebsiteVisitStore) {}

  /** No auth on the caller of this method — see analytics.controller.ts's
   * own comment on why POST /analytics/collect is deliberately public,
   * same reasoning as Booking/Rating/NPS's own submit endpoints. `path`
   * being empty is the one real input error worth rejecting outright
   * (an empty page path is never a real page); tenantId/sessionId are
   * trusted the same way Booking/Rating trust an unauthenticated caller's
   * tenantId — a stranger could record fake visits for a tenantId they
   * guess, a data-integrity nuisance bounded by rate limiting, not an
   * authorization breach (this write can't read or affect anything
   * outside website_visit). */
  async recordVisit(input: RecordVisitInput): Promise<void> {
    if (!input.path.trim()) throw new InvalidVisitError("path is required");
    await this.store.save({
      id: input.id,
      tenantId: input.tenantId,
      sessionId: input.sessionId,
      path: input.path,
      referrer: input.referrer,
      country: input.country,
      deviceType: classifyDeviceType(input.userAgent),
      occurredAt: new Date(),
    });
  }

  async getSummary(tenantId: string, periodStart: Date, periodEnd: Date): Promise<AnalyticsSummary> {
    const visits = await this.store.findAllForTenant(tenantId, periodStart, periodEnd);
    return computeAnalyticsSummary(visits, { start: periodStart, end: periodEnd });
  }
}

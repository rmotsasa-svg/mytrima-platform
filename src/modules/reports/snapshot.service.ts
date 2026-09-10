import { Injectable } from "@nestjs/common";
import { Period, previousPeriod, computeDelta, Delta } from "../../common/period";
import { SaleService, SalesKpis, RepeatRateResult } from "../sales/sale.service";
import { NpsService, computeNps } from "../growth-audit/nps.service";
import { RatingService } from "../reputation/rating.service";
import { GrowthAuditService } from "../growth-audit/growth-audit.service";
import { RecommendationService } from "../growth-audit/recommendation.service";

/**
 * The consolidated "Business Snapshot" report — prompted directly by a real
 * reference document the user supplied (a sample multi-location salon-chain
 * quarterly summary): Executive Summary -> Performance Snapshot ->
 * Experience Metrics -> Findings -> Action Plan -> Methodology & Caveats.
 * Built to close the gap identified by deep review: every report in this
 * platform used to be a separate, unrelated endpoint with no time
 * dimension except Growth Audit — a tenant had to visit 8+ endpoints and
 * mentally synthesize them. This is the one place that answers "how is my
 * business doing" in a single call.
 *
 * Same "no fabricated benchmark" discipline as everywhere else: every
 * comparison here is self-referential (this tenant's own immediately
 * preceding period of the same length — see common/period.ts), never an
 * invented industry figure. The reference document's own external
 * benchmarks ("60% healthy onboarding baseline," NPS/rating bands) were
 * given as real inputs to that report by a human business analyst — this
 * platform has no equivalent citable source for a universal threshold, so
 * it deliberately does NOT invent one; see the Methodology section this
 * generates for exactly that disclosure.
 *
 * A real, deliberate scope limit: no per-location/branch breakdown, unlike
 * the reference document's own per-salon table. Mytrima's Sales module has
 * no location dimension at all — every KPI is tenant-wide. Adding one is a
 * real product-scope decision (new schema, a location entity) that hasn't
 * been confirmed as needed by any real pilot tenant, so it isn't guessed at
 * here — see README.md.
 */

export interface SnapshotFinding {
  title: string;
  body: string;
}

export interface SnapshotActionItem {
  label: string;
  why: string;
  effort: "low" | "medium";
  category: "quick_win" | "strategic";
}

export interface BusinessSnapshot {
  period: Period;
  previousPeriod: Period;
  executiveSummary: string[];
  performance: {
    salesAmount: Delta;
    transactionalVolume: Delta;
    averageTransactionValue: Delta;
    conversionRate: { current: number | null; previous: number | null };
    churnRate: { current: number | null; previous: number | null };
    repeatRate: { current: number | null; previous: number | null };
  };
  experienceMetrics: {
    nps: { current: number | null; previous: number | null; currentCount: number };
    rating: { current: number | null; previous: number | null; currentCount: number };
  };
  growthAudit: {
    latestScore: number | null;
    latestBand: string | null;
    previousScore: number | null;
  };
  findings: SnapshotFinding[];
  actionPlan: SnapshotActionItem[];
  methodology: string[];
  generatedAt: Date;
}

// Meaningful-change threshold for surfacing a finding — a disclosed
// default (points, not %), not a researched optimum, same as every other
// undecided-but-necessary number in this project.
const MEANINGFUL_POINT_CHANGE = 5;

/** Pure — given already-gathered current/previous data, builds the
 * findings + methodology text. Exported standalone so this is
 * unit-testable against hand-built fixtures with no real services
 * constructed at all, same discipline as every other pure function in
 * this project (scoreAudit, computeOnboardingStatus, computeRecommendations). */
export function buildFindingsAndMethodology(input: {
  salesKpis: SalesKpis;
  previousSalesKpis: SalesKpis | null;
  repeatRate: RepeatRateResult;
  previousRepeatRate: RepeatRateResult | null;
  nps: { current: number | null; previous: number | null };
  rating: { current: number | null; previous: number | null };
  hasLocationBreakdown: false; // always false today — see this file's own top comment
}): { findings: SnapshotFinding[]; methodology: string[] } {
  const findings: SnapshotFinding[] = [];

  if (input.previousSalesKpis && input.salesKpis.churnRate !== null && input.previousSalesKpis.churnRate !== null) {
    const delta = computeDelta(input.salesKpis.churnRate, input.previousSalesKpis.churnRate);
    if (delta.absoluteChange !== null && Math.abs(delta.absoluteChange) >= MEANINGFUL_POINT_CHANGE) {
      findings.push({
        title: delta.absoluteChange > 0 ? "Churn rate is up" : "Churn rate improved",
        body: `Churn rate moved from ${input.previousSalesKpis.churnRate}% to ${input.salesKpis.churnRate}% versus the previous period of the same length (${delta.absoluteChange > 0 ? "+" : ""}${delta.absoluteChange} points).`,
      });
    }
  }

  if (input.previousRepeatRate && input.repeatRate.repeatRate !== null && input.previousRepeatRate.repeatRate !== null) {
    const delta = computeDelta(input.repeatRate.repeatRate, input.previousRepeatRate.repeatRate);
    if (delta.absoluteChange !== null && Math.abs(delta.absoluteChange) >= MEANINGFUL_POINT_CHANGE) {
      const impactEstimate =
        delta.absoluteChange < 0
          ? Math.round(((Math.abs(delta.absoluteChange) / 100) * input.repeatRate.newCustomerCount * input.salesKpis.averageTransactionValue) * 100) / 100
          : null;
      findings.push({
        title: delta.absoluteChange > 0 ? "New-customer repeat rate improved" : "New-customer repeat rate dropped",
        body:
          `Of ${input.repeatRate.newCustomerCount} new customers this period, ${input.repeatRate.repeatRate}% came back for a second purchase, ` +
          `versus ${input.previousRepeatRate.repeatRate}% last period (${delta.absoluteChange > 0 ? "+" : ""}${delta.absoluteChange} points).` +
          (impactEstimate !== null
            ? ` If the previous rate had held, that's roughly an estimated ${impactEstimate} in additional revenue this period (real historical average order value x the customer-count gap — directional, not a guarantee).`
            : ""),
      });
    }
  }

  if (input.nps.current !== null && input.nps.previous !== null) {
    const delta = computeDelta(input.nps.current, input.nps.previous);
    if (delta.absoluteChange !== null && Math.abs(delta.absoluteChange) >= MEANINGFUL_POINT_CHANGE) {
      findings.push({
        title: delta.absoluteChange > 0 ? "NPS improved" : "NPS declined",
        body: `NPS moved from ${input.nps.previous} to ${input.nps.current} versus the previous period (${delta.absoluteChange > 0 ? "+" : ""}${delta.absoluteChange}).`,
      });
    }
  }

  const methodology: string[] = [
    "All comparisons are against this business's own immediately preceding period of the same length — not an external industry benchmark, since none is cited for this platform's own reference set yet.",
    "No per-location or per-branch breakdown is available — every metric here is tenant-wide, even for a multi-location business.",
    "Revenue figures reflect gross transaction totals, not margin.",
    "Growth Audit score reflects self-reported answers to a 40-question instrument. Where a real activity signal contradicts a self-reported answer, that's flagged as its own recommendation-engine insight, not silently trusted.",
  ];

  return { findings, methodology };
}

@Injectable()
export class SnapshotService {
  constructor(
    private readonly saleService: SaleService,
    private readonly npsService: NpsService,
    private readonly ratingService: RatingService,
    private readonly growthAuditService: GrowthAuditService,
    private readonly recommendationService: RecommendationService
  ) {}

  async getSnapshot(tenantId: string, period: Period): Promise<BusinessSnapshot> {
    const prevPeriod = previousPeriod(period);

    const [salesKpis, previousSalesKpis, repeatRate, previousRepeatRate, nps, previousNps, rating, previousRating, auditHistory, recommendations] =
      await Promise.all([
        this.saleService.computeKpis(tenantId, period.start, period.end),
        this.saleService.computeKpis(tenantId, prevPeriod.start, prevPeriod.end),
        this.saleService.computeRepeatRate(tenantId, period.start, period.end),
        this.saleService.computeRepeatRate(tenantId, prevPeriod.start, prevPeriod.end),
        this.periodNps(tenantId, period),
        this.periodNps(tenantId, prevPeriod),
        this.periodRating(tenantId, period),
        this.periodRating(tenantId, prevPeriod),
        this.growthAuditService.listForTenant(tenantId),
        this.recommendationService.getRecommendations(tenantId),
      ]);

    const { findings, methodology } = buildFindingsAndMethodology({
      salesKpis,
      previousSalesKpis,
      repeatRate,
      previousRepeatRate,
      nps: { current: nps.count > 0 ? nps.nps : null, previous: previousNps.count > 0 ? previousNps.nps : null },
      rating: { current: rating.count > 0 ? rating.averageStars : null, previous: previousRating.count > 0 ? previousRating.averageStars : null },
      hasLocationBreakdown: false,
    });

    const actionPlan: SnapshotActionItem[] = recommendations.actions.map((a) => ({
      label: a.actionLabel,
      why: `Answered "${a.questionText}" as weak (${a.score}/4).`,
      effort: "low",
      category: "quick_win",
    }));
    if (recommendations.topSectionHasNoAppSignal) {
      actionPlan.push({
        label: "Review your biggest weak area with a business advisor",
        why: "Your biggest scoring opportunity this audit has no in-app signal this platform can verify automatically.",
        effort: "medium",
        category: "strategic",
      });
    }

    const latest = auditHistory[auditHistory.length - 1];
    const previousAudit = auditHistory[auditHistory.length - 2];

    const executiveSummary = this.buildExecutiveSummary(salesKpis, previousSalesKpis, findings);

    return {
      period,
      previousPeriod: prevPeriod,
      executiveSummary,
      performance: {
        salesAmount: computeDelta(salesKpis.salesAmount, previousSalesKpis.salesAmount),
        transactionalVolume: computeDelta(salesKpis.transactionalVolume, previousSalesKpis.transactionalVolume),
        averageTransactionValue: computeDelta(salesKpis.averageTransactionValue, previousSalesKpis.averageTransactionValue),
        conversionRate: { current: salesKpis.conversionRate, previous: previousSalesKpis.conversionRate },
        churnRate: { current: salesKpis.churnRate, previous: previousSalesKpis.churnRate },
        repeatRate: { current: repeatRate.repeatRate, previous: previousRepeatRate.repeatRate },
      },
      experienceMetrics: {
        nps: { current: nps.count > 0 ? nps.nps : null, previous: previousNps.count > 0 ? previousNps.nps : null, currentCount: nps.count },
        rating: {
          current: rating.count > 0 ? rating.averageStars : null,
          previous: previousRating.count > 0 ? previousRating.averageStars : null,
          currentCount: rating.count,
        },
      },
      growthAudit: {
        latestScore: latest?.result.overallScore ?? null,
        latestBand: latest?.result.band ?? null,
        previousScore: previousAudit?.result.overallScore ?? null,
      },
      findings,
      actionPlan,
      methodology,
      generatedAt: new Date(),
    };
  }

  private buildExecutiveSummary(current: SalesKpis, previous: SalesKpis, findings: SnapshotFinding[]): string[] {
    const summary: string[] = [];
    const salesDelta = computeDelta(current.salesAmount, previous.salesAmount);
    if (salesDelta.percentChange !== null) {
      summary.push(
        `Sales this period: ${current.salesAmount} across ${current.transactionalVolume} transactions, ${salesDelta.percentChange > 0 ? "up" : "down"} ${Math.abs(salesDelta.percentChange)}% versus the previous period.`
      );
    } else {
      summary.push(`Sales this period: ${current.salesAmount} across ${current.transactionalVolume} transactions.`);
    }
    if (findings.length > 0) {
      summary.push(`Biggest change this period: ${findings[0].title.toLowerCase()}.`);
    }
    return summary;
  }

  private async periodNps(tenantId: string, period: Period): Promise<{ nps: number; count: number }> {
    const all = await this.npsService.findAllForTenant(tenantId);
    const inPeriod = all.filter((r) => r.submittedAt >= period.start && r.submittedAt <= period.end);
    return { nps: computeNps(inPeriod), count: inPeriod.length };
  }

  private async periodRating(tenantId: string, period: Period): Promise<{ averageStars: number; count: number }> {
    const all = await this.ratingService.findAllForTenant(tenantId);
    const inPeriod = all.filter((r) => r.status === "public" && r.submittedAt >= period.start && r.submittedAt <= period.end);
    if (inPeriod.length === 0) return { averageStars: 0, count: 0 };
    const sum = inPeriod.reduce((s, r) => s + r.stars, 0);
    return { averageStars: Math.round((sum / inPeriod.length) * 100) / 100, count: inPeriod.length };
  }
}

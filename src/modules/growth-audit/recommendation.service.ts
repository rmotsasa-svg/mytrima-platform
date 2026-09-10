import { Inject, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { AuditResult, GrowthAuditResponse, GrowthAuditService } from "./growth-audit.service";
import { SectionKey, QUESTION_TEXT } from "./questions.data";
import { RECOMMENDATION_STORE } from "./growth-audit.tokens";
import { KpiBenchmarkService } from "../sales/kpi-benchmark.service";
import { RatingService } from "../reputation/rating.service";
import { DealService } from "../deals/deal.service";
import { SocialPostLogService } from "../social-publishing/social-post-log.service";
import { TenantService } from "../auth/tenant.service";

/**
 * The centerpiece of the deep-analysis recommendations: Growth Audit
 * diagnoses a business (score + band) and, until now, did nothing else —
 * one notification on a Critical band, no prescription, no way to see if a
 * tenant improved. For a "growth consultancy" product, closing that loop is
 * the actual mission, not an optional extra — see README.md's own
 * "Growth-strategy KPIs" and deep-analysis writeups for the full reasoning.
 *
 * Same "no fabricated benchmark" discipline as everywhere else in this
 * project: every target here is self-referential (this tenant's own
 * weighted opportunity, computed from the instrument's own rubric), never
 * an invented industry figure.
 */

export interface WeightedOpportunity {
  sectionKey: SectionKey;
  sectionName: string;
  sectionPct: number;
  weightPct: number;
  /** (100 - sectionPct) x weightPct / 100 — the real points of overall
   * score available in this section, not just "how bad is the grade."
   * Ranking by this instead of raw sectionPct is why a 20%-weighted
   * section at 30% outranks a 10%-weighted section at 10%, even though the
   * second one's raw percentage looks worse. */
  weightedOpportunity: number;
}

/** Ranks every section by real weighted headroom, descending — the biggest
 * genuine lever first, not just the lowest grade. Pure function, exported
 * standalone so it's independently testable against hand-calculated
 * examples, same pattern as scoreAudit() itself. */
export function rankSectionsByWeightedOpportunity(result: AuditResult): WeightedOpportunity[] {
  return result.sections
    .map((s) => ({
      sectionKey: s.key,
      sectionName: s.name,
      sectionPct: s.sectionPct,
      weightPct: s.weightPct,
      weightedOpportunity: Math.round((((100 - s.sectionPct) * s.weightPct) / 100) * 100) / 100,
    }))
    .sort((a, b) => b.weightedOpportunity - a.weightedOpportunity);
}

export interface RecommendationSignals {
  hasConversionRateBenchmark: boolean;
  hasChurnRateBenchmark: boolean;
  hasAnyKpiBenchmark: boolean;
  hasRecentRating: boolean;
  hasActiveDeal: boolean;
  hasPostedRecently: boolean;
  hasNotificationPhone: boolean;
}

export interface RecommendedAction {
  sectionKey: SectionKey;
  questionId: number;
  questionText: string;
  score: number;
  actionKey: string;
  actionLabel: string;
}

/** A tenant answered a question as weak, but a REAL in-app signal shows
 * they're already doing it — the "self-report vs. real signal divergence"
 * insight: data this platform already has catching something a survey
 * answer alone couldn't, distinctive value the recommendation engine
 * itself provides beyond just relaying the audit's own scores. */
export interface DivergenceInsight {
  questionId: number;
  questionText: string;
  score: number;
  note: string;
}

interface QuestionActionMapping {
  questionId: number;
  actionKey: string;
  actionLabel: string;
  checkSignal: (signals: RecommendationSignals) => boolean;
}

/**
 * A real, deliberately incomplete mapping — only questions with a genuine,
 * verifiable in-app proxy are here. Section C (Business Strategy) and
 * Section E (Brand & Positioning) have NO entries at all: nothing in this
 * schema can verify a written business plan, a SWOT analysis, brand
 * consistency across channels, or competitor price benchmarking. That's a
 * real, disclosed gap (see README.md), not silently papered over with a
 * weak or invented proxy.
 */
const QUESTION_ACTIONS: QuestionActionMapping[] = [
  {
    questionId: 3,
    actionKey: "set_conversion_rate_benchmark",
    actionLabel: "Set a KPI benchmark for your conversion rate (Sales module)",
    checkSignal: (s) => s.hasConversionRateBenchmark,
  },
  {
    questionId: 6,
    actionKey: "set_any_kpi_benchmark",
    actionLabel: "Set a KPI benchmark to track a key sales number",
    checkSignal: (s) => s.hasAnyKpiBenchmark,
  },
  {
    questionId: 9,
    actionKey: "request_rating",
    actionLabel: "Request a rating from a recent customer",
    checkSignal: (s) => s.hasRecentRating,
  },
  {
    questionId: 15,
    actionKey: "request_rating",
    actionLabel: "Request a rating from a recent customer",
    checkSignal: (s) => s.hasRecentRating,
  },
  {
    questionId: 23,
    actionKey: "set_churn_rate_benchmark",
    actionLabel: "Set a KPI benchmark for your Churn Rate (Sales module)",
    checkSignal: (s) => s.hasChurnRateBenchmark,
  },
  {
    questionId: 24,
    actionKey: "set_churn_rate_benchmark",
    actionLabel: "Set a KPI benchmark for your Churn Rate (Sales module)",
    checkSignal: (s) => s.hasChurnRateBenchmark,
  },
  {
    questionId: 27,
    actionKey: "create_deal",
    actionLabel: "Create a Deal to encourage repeat business",
    checkSignal: (s) => s.hasActiveDeal,
  },
  {
    questionId: 34,
    actionKey: "post_to_social",
    actionLabel: "Post to your connected Facebook/Instagram Page",
    checkSignal: (s) => s.hasPostedRecently,
  },
  {
    questionId: 36,
    actionKey: "set_notification_phone",
    actionLabel: "Set a WhatsApp notification phone number",
    checkSignal: (s) => s.hasNotificationPhone,
  },
  {
    questionId: 39,
    actionKey: "set_any_kpi_benchmark",
    actionLabel: "Set a KPI benchmark to track a key sales number",
    checkSignal: (s) => s.hasAnyKpiBenchmark,
  },
];

const WEAK_ANSWER_THRESHOLD = 2; // 0-4 scale — scores below this are treated as "needs improvement"

export interface RecommendationResult {
  rankedSections: WeightedOpportunity[];
  actions: RecommendedAction[];
  divergences: DivergenceInsight[];
  /** Set when the top-ranked section has no verifiable in-app proxy at all
   * (Sections C/E) — an honest "we can't automatically check this one"
   * flag, not a silently empty actions list. */
  topSectionHasNoAppSignal: boolean;
}

/** Pure — given a real GrowthAuditResponse and real gathered signals,
 * decides what to recommend. Exported standalone so this is unit-testable
 * against hand-built fixtures with no real services constructed at all,
 * same discipline as scoreAudit()/computeOnboardingStatus(). */
export function computeRecommendations(response: GrowthAuditResponse, signals: RecommendationSignals, maxActions = 5): RecommendationResult {
  const rankedSections = rankSectionsByWeightedOpportunity(response.result);
  const actions: RecommendedAction[] = [];
  const divergences: DivergenceInsight[] = [];
  const seenActionKeys = new Set<string>();

  for (const section of rankedSections) {
    if (actions.length >= maxActions) break;
    const sectionDef = response.result.sections.find((s) => s.key === section.sectionKey);
    if (!sectionDef) continue;

    // This section's own questions, weakest first.
    const weakQuestionsInSection = QUESTION_ACTIONS.filter((mapping) => isQuestionInSection(mapping.questionId, section.sectionKey)).sort(
      (a, b) => response.answers[a.questionId] - response.answers[b.questionId]
    );

    for (const mapping of weakQuestionsInSection) {
      if (actions.length >= maxActions) break;
      const score = response.answers[mapping.questionId];
      const alreadyDoingIt = mapping.checkSignal(signals);

      if (alreadyDoingIt) {
        if (score < WEAK_ANSWER_THRESHOLD) {
          // Self-report says weak, real data says otherwise.
          divergences.push({
            questionId: mapping.questionId,
            questionText: QUESTION_TEXT[mapping.questionId],
            score,
            note: `Answered as weak, but real activity data shows this is already happening.`,
          });
        }
        continue; // don't recommend something they're already doing
      }
      if (score >= WEAK_ANSWER_THRESHOLD) continue; // not actually weak enough to prioritize
      if (seenActionKeys.has(mapping.actionKey)) continue; // same action already queued from another question

      actions.push({
        sectionKey: section.sectionKey,
        questionId: mapping.questionId,
        questionText: QUESTION_TEXT[mapping.questionId],
        score,
        actionKey: mapping.actionKey,
        actionLabel: mapping.actionLabel,
      });
      seenActionKeys.add(mapping.actionKey);
    }
  }

  const topSectionHasNoAppSignal = actions.length === 0 && (rankedSections[0]?.sectionKey === "C" || rankedSections[0]?.sectionKey === "E");

  return { rankedSections, actions, divergences, topSectionHasNoAppSignal };
}

function isQuestionInSection(questionId: number, sectionKey: SectionKey): boolean {
  const ranges: Record<SectionKey, [number, number]> = {
    A: [1, 8],
    B: [9, 16],
    C: [17, 22],
    D: [23, 28],
    E: [29, 32],
    F: [33, 36],
    G: [37, 40],
  };
  const [start, end] = ranges[sectionKey];
  return questionId >= start && questionId <= end;
}

export interface RecommendationLogEntry {
  id: string;
  tenantId: string;
  growthAuditResponseId: string;
  sectionKey: SectionKey;
  questionId: number;
  actionKey: string;
  actionLabel: string;
  createdAt: Date;
  actionDetectedAt: Date | null;
}

export interface RecommendationStore {
  save(entry: RecommendationLogEntry): Promise<void>;
  findAllForTenant(tenantId: string): Promise<RecommendationLogEntry[]>;
  /** tenantId is required here (not just `id`) so the real Postgres store
   * can run this within the correct RLS tenant context — a real bug caught
   * before it shipped: an update with no tenant context set would silently
   * affect zero rows, since the table's own RLS policy compares tenant_id
   * against current_setting('app.current_tenant_id', true), which is null
   * (matching nothing) outside a tenant context. */
  markDetected(tenantId: string, id: string, detectedAt: Date): Promise<void>;
}

@Injectable()
export class RecommendationService {
  constructor(
    @Inject(RECOMMENDATION_STORE) private readonly store: RecommendationStore,
    private readonly growthAuditService: GrowthAuditService,
    private readonly kpiBenchmarkService: KpiBenchmarkService,
    private readonly ratingService: RatingService,
    private readonly dealService: DealService,
    private readonly socialPostLogService: SocialPostLogService,
    private readonly tenantService: TenantService
  ) {}

  /** Gathers every real signal computeRecommendations() needs, from the
   * real services that already own each piece of data — no new schema for
   * any of this beyond what the recommendation log itself needs (see
   * RecommendationLogEntry below). A 30-day recency window for
   * "recent rating"/"posted recently" is a disclosed default, not a
   * researched optimum, same as every other undecided-but-necessary number
   * in this project. */
  private async gatherSignals(tenantId: string): Promise<RecommendationSignals> {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const [benchmarks, ratings, deals, hasPostedRecently, tenant] = await Promise.all([
      this.kpiBenchmarkService.listActiveForTenant(tenantId),
      this.ratingService.findAllForTenant(tenantId),
      this.dealService.listForTenant(tenantId),
      this.socialPostLogService.hasPostedRecently(tenantId, 30),
      this.tenantService.getById(tenantId),
    ]);

    return {
      hasConversionRateBenchmark: benchmarks.some((b) => b.kpi === "conversion_rate"),
      hasChurnRateBenchmark: benchmarks.some((b) => b.kpi === "churn_rate"),
      hasAnyKpiBenchmark: benchmarks.length > 0,
      hasRecentRating: ratings.some((r) => r.submittedAt >= thirtyDaysAgo),
      hasActiveDeal: deals.some((d) => d.isActive),
      hasPostedRecently,
      hasNotificationPhone: !!tenant?.notificationPhoneE164,
    };
  }

  /**
   * Real recommendation-to-action tracking (the KPI the deep-analysis
   * design called out as the one that actually proves the loop works, not
   * just "we sent a message and hoped"): every time this is called, first
   * re-checks any of this tenant's PAST undetected recommendations against
   * the CURRENT signals — if the real action has since appeared, it's
   * stamped detected, permanently, without needing a separate scheduled
   * job. Lazy detection on read, not proactive polling — a real, disclosed
   * tradeoff (see README.md), acceptable for a dashboard-driven read
   * pattern at this pilot's scale.
   */
  async getRecommendations(tenantId: string): Promise<RecommendationResult & { actionToActionRate: number | null }> {
    const signals = await this.gatherSignals(tenantId);
    const responses = await this.growthAuditService.listForTenant(tenantId);
    const latest = responses[responses.length - 1];

    const pastEntries = await this.store.findAllForTenant(tenantId);
    await this.detectCompletedActions(pastEntries, signals);

    if (!latest) {
      return { rankedSections: [], actions: [], divergences: [], topSectionHasNoAppSignal: false, actionToActionRate: this.computeActionRate(pastEntries) };
    }

    const result = computeRecommendations(latest, signals);
    await this.persistNewRecommendations(tenantId, latest, result.actions, pastEntries);

    const refreshedEntries = await this.store.findAllForTenant(tenantId);
    return { ...result, actionToActionRate: this.computeActionRate(refreshedEntries) };
  }

  private async detectCompletedActions(entries: RecommendationLogEntry[], signals: RecommendationSignals): Promise<void> {
    const undetected = entries.filter((e) => !e.actionDetectedAt);
    for (const entry of undetected) {
      const mapping = QUESTION_ACTIONS.find((m) => m.actionKey === entry.actionKey);
      if (mapping?.checkSignal(signals)) {
        await this.store.markDetected(entry.tenantId, entry.id, new Date());
      }
    }
  }

  private async persistNewRecommendations(
    tenantId: string,
    response: GrowthAuditResponse,
    actions: RecommendedAction[],
    existingEntries: RecommendationLogEntry[]
  ): Promise<void> {
    const alreadyLogged = new Set(existingEntries.filter((e) => e.growthAuditResponseId === response.id).map((e) => e.actionKey));
    for (const action of actions) {
      if (alreadyLogged.has(action.actionKey)) continue;
      await this.store.save({
        id: randomUUID(),
        tenantId,
        growthAuditResponseId: response.id,
        sectionKey: action.sectionKey,
        questionId: action.questionId,
        actionKey: action.actionKey,
        actionLabel: action.actionLabel,
        createdAt: new Date(),
        actionDetectedAt: null,
      });
    }
  }

  private computeActionRate(entries: RecommendationLogEntry[]): number | null {
    if (entries.length === 0) return null;
    const detected = entries.filter((e) => e.actionDetectedAt !== null).length;
    return Math.round((detected / entries.length) * 10000) / 100;
  }
}

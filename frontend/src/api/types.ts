/**
 * Response/request shapes mirrored by hand from the real backend source
 * (not generated) — src/modules/*​/*.service.ts and *.controller.ts in the
 * main repo. Kept intentionally narrow to what this SPA actually renders;
 * every field below has a matching field in the real backend interface it
 * names, so a backend shape change that isn't reflected here will show up
 * as a real TypeScript error the next time this file is touched, not a
 * silent runtime mismatch.
 */

export type Role = "owner" | "staff" | "read_only";

/** GET /auth/tenants/me's own shape — mirrors TenantRecord
 * (tenant.service.ts) exactly. Every field past id/name is optional: a
 * fresh tenant genuinely hasn't filled any of these in yet (migration
 * 0024) — not a loading state or an error, a real "not set" answer. */
export interface TenantProfile {
  id: string;
  name: string;
  notificationPhoneE164?: string;
  payfastMerchantId?: string;
  description?: string;
  industry?: string;
  location?: string;
  contactEmail?: string;
  contactPhone?: string;
  businessGoal?: string;
}

/** PATCH /auth/tenants/business-profile's own body — BusinessProfileInput
 * (tenant.service.ts) mirrored: every field optional, a tenant fills this
 * in incrementally. */
export interface BusinessProfileInput {
  description?: string;
  industry?: string;
  location?: string;
  contactEmail?: string;
  contactPhone?: string;
  businessGoal?: string;
}

export interface VerifiedAccessToken {
  userId: string;
  tenantId: string;
  role: Role;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

export interface MfaEnrollmentRequired {
  mfaEnrollmentRequired: true;
  enrollmentToken: string;
}

export interface MfaEnrollStartResult {
  secret: string;
  otpauthUrl: string;
}

export interface StaffProfile {
  id: string;
  tenantId: string;
  email: string;
  role: Role;
  mfaEnabled: boolean;
  isActive: boolean;
  createdAt: string;
}

export type ItemType = "product" | "service";

export interface CatalogItem {
  id: string;
  tenantId: string;
  name: string;
  itemType: ItemType;
  sku?: string;
  unitPrice: number;
  durationMinutes?: number;
  isActive: boolean;
  createdAt: string;
}

export interface Customer {
  id: string;
  tenantId: string;
  displayName?: string;
  phone?: string;
  email?: string;
  createdAt: string;
}

export type SaleSource = "manual" | "imported";

export interface SaleLineItem {
  catalogItemId: string;
  quantity: number;
  unitPrice: number;
  discountAmount?: number;
}

/** Mirrors Deal in deal.service.ts — a standalone offer catalog a sale can
 * optionally apply (SaleTransaction's own `dealId`). One generalized
 * discount_type model rather than a separate type per promotion pattern —
 * only the fields that type actually uses are meaningful (e.g.
 * `percentageOff` for "percentage_off", ignored for the other two). */
export type DiscountType = "percentage_off" | "buy_x_get_y_free" | "fixed_amount_off";

export interface Deal {
  id: string;
  tenantId: string;
  name: string;
  discountType: DiscountType;
  percentageOff?: number;
  buyQuantity?: number;
  freeQuantity?: number;
  fixedAmountOff?: number;
  startsAt?: string;
  endsAt?: string;
  isActive: boolean;
  catalogItemIds: string[];
  createdAt: string;
}

export interface SaleTransaction {
  id: string;
  tenantId: string;
  customerId?: string;
  recordedByUserId?: string;
  source: SaleSource;
  occurredAt: string;
  subtotalAmount: number;
  discountAmount: number;
  totalAmount: number;
  dealId?: string;
  lineItems: SaleLineItem[];
  createdAt: string;
}

export interface SalesKpis {
  periodStart: string;
  periodEnd: string;
  transactionalVolume: number;
  salesAmount: number;
  averageTransactionValue: number;
  totalUnits: number;
  unitsPerTransaction: number;
  addonRate: number;
  conversionRate: number | null;
  churnRate: number | null;
}

export interface CustomerLifetimeValueResult {
  averageOrderValue: number;
  purchaseFrequencyPerYear: number;
  customerLifespanYears: number;
  lifetimeValue: number;
}

export interface RepeatRateResult {
  periodStart: string;
  periodEnd: string;
  newCustomerCount: number;
  repeatCustomerCount: number;
  repeatRate: number | null;
}

export interface SalesTarget {
  id: string;
  tenantId: string;
  userId?: string;
  periodStart: string;
  periodEnd: string;
  targetAmount: number;
  createdAt: string;
}

export type BenchmarkKpi =
  | "sales_amount"
  | "conversion_rate"
  | "avg_transaction_value"
  | "units_per_transaction"
  | "transactional_volume"
  | "addon_rate"
  | "churn_rate";

export type BenchmarkComparison = "above" | "below";

export interface KpiBenchmark {
  id: string;
  tenantId: string;
  userId?: string;
  kpi: BenchmarkKpi;
  comparison: BenchmarkComparison;
  thresholdValue: number;
  periodStart: string;
  periodEnd: string;
  isActive: boolean;
  createdAt: string;
}

export interface Page<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

export type BookingStatus = "requested" | "confirmed" | "completed" | "cancelled" | "no_show";

export interface Booking {
  id: string;
  tenantId: string;
  customerId: string;
  catalogItemId: string;
  scheduledAt: string;
  durationMinutes: number;
  status: BookingStatus;
  notes?: string;
  createdAt: string;
}

export type SupportTicketSeverity = "low" | "normal" | "high" | "critical";
export type SupportTicketStatus = "open" | "in_progress" | "resolved";

export interface SupportTicket {
  id: string;
  tenantId: string;
  createdByUserId: string;
  subject: string;
  description: string;
  severity: SupportTicketSeverity;
  status: SupportTicketStatus;
  resolutionNotes?: string;
  createdAt: string;
  updatedAt: string;
}

interface Delta {
  current: number;
  previous: number;
  changePct: number | null;
}

interface Period {
  start: string;
  end: string;
}

export interface SnapshotFinding {
  headline: string;
  detail: string;
  severity: "positive" | "neutral" | "attention";
}

/** REAL BUG found live-testing the whole platform end to end (2026-09-12):
 * this mirrored snapshot.service.ts's OWN SnapshotActionItem interface as
 * `{ title, rationale }` — but the real backend shape (confirmed by
 * reading snapshot.service.ts directly, and by an actual `GET
 * /reports/:tenantId/snapshot` response) is `{ label, why, effort,
 * category }`. Neither field name existed on the real object, so
 * SnapshotPage.tsx's `<strong>{item.title}</strong>` rendered a real,
 * silently blank list item — visible proof of the exact "a hand-mirrored
 * type can drift from the backend with no compiler error" risk this
 * file's own top comment already warns about, since nothing here is
 * generated from the backend's actual types. */
export interface SnapshotActionItem {
  label: string;
  why: string;
  effort: "low" | "medium";
  category: "quick_win" | "strategic";
}

export type SectionKey = "A" | "B" | "C" | "D" | "E" | "F" | "G";

export interface AuditSection {
  key: SectionKey;
  name: string;
  weightPct: number;
  questionIds: number[];
}

export interface GrowthAuditQuestions {
  sections: AuditSection[];
  questionText: Record<number, string>;
}

/** question id -> score, 0 (not in place) through 4 (fully in place) — see
 * questions.data.ts/growth-audit.service.ts's own comments; the 40-question
 * instrument itself lives entirely on the backend, this SPA renders
 * whatever GET /growth-audit/questions returns rather than duplicating it. */
export type GrowthAuditAnswers = Record<number, number>;

export interface AuditSectionResult {
  key: SectionKey;
  name: string;
  rawScore: number;
  maxScore: number;
  sectionPct: number;
  weightPct: number;
  weightedContribution: number;
}

export type PerformanceBand = "Critical" | "Weak" | "Stable" | "High-Growth";

export interface AuditResult {
  sections: AuditSectionResult[];
  overallScore: number;
  band: PerformanceBand;
}

export interface GrowthAuditResponse {
  id: string;
  tenantId: string;
  answers: GrowthAuditAnswers;
  result: AuditResult;
  submittedAt: string;
}

export interface WeightedOpportunity {
  sectionKey: SectionKey;
  sectionName: string;
  sectionPct: number;
  weightPct: number;
  weightedOpportunity: number;
}

export interface RecommendedAction {
  sectionKey: SectionKey;
  questionId: number;
  questionText: string;
  score: number;
  actionKey: string;
  actionLabel: string;
}

export interface DivergenceInsight {
  questionId: number;
  questionText: string;
  score: number;
  note: string;
}

export interface RecommendationResult {
  rankedSections: WeightedOpportunity[];
  actions: RecommendedAction[];
  divergences: DivergenceInsight[];
  topSectionHasNoAppSignal: boolean;
  actionToActionRate: number | null;
}

export type RatingStatus = "pending" | "public" | "hidden";

export interface Rating {
  id: string;
  tenantId: string;
  customerId: string;
  stars: number;
  comment?: string;
  status: RatingStatus;
  submittedAt: string;
  moderatedAt?: string;
}

export interface RatingAggregate {
  averageStars: number;
  count: number;
}

export interface NpsResponse {
  id: string;
  tenantId: string;
  customerId: string;
  score: number;
  comment?: string;
  submittedAt: string;
}

export interface NpsAggregate {
  nps: number;
  count: number;
}

/** GET /social/:tenantId/connection's own shape — deliberately narrower
 * than the backend's internal SocialConnection record (no pageAccessToken;
 * see social-publishing.controller.ts's own comment on why that never
 * leaves the response). */
export type SocialConnectionStatus = { connected: false } | { connected: true; pageId: string; pageName: string; instagramConnected: boolean };

export interface OnboardingStep {
  key: string;
  label: string;
  completed: boolean;
}

export interface OnboardingStatus {
  steps: OnboardingStep[];
  completedCount: number;
  totalCount: number;
  percentComplete: number;
}

export interface BusinessSnapshot {
  period: Period;
  previousPeriod: Period;
  executiveSummary: string[];
  performance: {
    salesAmount: Delta;
    transactionalVolume: Delta;
    averageTransactionValue: Delta;
    totalUnits: Delta;
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
  socialMetrics: { connected: boolean } & Record<string, unknown>;
  methodology: string[];
  generatedAt: string;
}

/** Mirrors AnalyticsSummary in website-visit.service.ts (added 2026-09-11
 * for the website-analytics feature) — see mytrima-analytics.js for the
 * tracking snippet a tenant embeds on their own site to produce this data,
 * and BusinessProfilePage.tsx's own "Website" field for where a tenant
 * would find their site's URL to point the snippet at. */
export type DeviceType = "desktop" | "mobile" | "tablet" | "other";

export interface AnalyticsSummary {
  periodStart: string;
  periodEnd: string;
  totalVisits: number;
  uniqueSessions: number;
  topPaths: { path: string; count: number }[];
  topReferrers: { referrer: string; count: number }[];
  deviceBreakdown: Record<DeviceType, number>;
  visitsByDay: { date: string; count: number }[];
}

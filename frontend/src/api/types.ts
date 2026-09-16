/**
 * Response/request shapes mirrored by hand from the real backend source
 * (not generated) — src/modules/*​/*.service.ts and *.controller.ts in the
 * main repo. Kept intentionally narrow to what this SPA actually renders;
 * every field below has a matching field in the real backend interface it
 * names, so a backend shape change that isn't reflected here will show up
 * as a real TypeScript error the next time this file is touched, not a
 * silent runtime mismatch.
 */

/** "manager" added 2026-09-14 at the tenant's own explicit request — see
 * rbac.ts's own comment for exactly which two real permissions
 * (petty_cash:manage, refund:manage) move to it and off plain "staff". */
export type Role = "owner" | "manager" | "staff" | "read_only";

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
  /** "Create staff id numbers" — the tenant's own explicit request
   * (2026-09-15). A short badge number ("STAFF-0001"), distinct from `id`. */
  staffIdNumber: string;
  email: string;
  firstName?: string;
  lastName?: string;
  role: Role;
  mfaEnabled: boolean;
  isActive: boolean;
  createdAt: string;
}

/** Mirrors StaffActivityLogEntry (auth/staff-activity.service.ts) — see its
 * own comment for exactly which real actions are logged. */
export interface StaffActivityLogEntry {
  id: string;
  tenantId: string;
  userId: string;
  action: "petty_cash.replenish" | "petty_cash.pay_vendor" | "sale.refund" | "sale.recorded" | "booking.created_by_staff";
  details?: Record<string, unknown>;
  occurredAt: string;
}

/** Mirrors CommissionRate (commission/commission.service.ts) — "add staff
 * commission module", the tenant's own explicit request (2026-09-15). */
export interface CommissionRate {
  id: string;
  tenantId: string;
  userId: string;
  ratePercent: number;
  createdAt: string;
}

/** Mirrors StaffPerformance (commission/staff-performance.service.ts) —
 * "track staff performance", the tenant's own explicit request
 * (2026-09-15). See that file's own comment on customersUpdated's one
 * disclosed limitation (last-editor only, not a full edit history). */
export interface StaffPerformance {
  userId: string;
  periodStart: string;
  periodEnd: string;
  salesCount: number;
  salesAmount: number;
  customersCreated: number;
  customersUpdated: number;
  commissionRatePercent: number | null;
  commissionEarned: number;
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
  /** A real uploaded product/service photo — see the backend's
   * common/uploads.ts for the local-disk-storage decision. A relative
   * path (e.g. "/uploads/catalog/<tenantId>/<file>.png") served by the
   * same backend origin API_BASE_URL points at, not an absolute URL. */
  imageUrl?: string;
  createdAt: string;
}

export type CustomerGender = "female" | "male" | "other" | "prefer_not_to_say";

export interface Customer {
  id: string;
  tenantId: string;
  displayName?: string;
  phone?: string;
  email?: string;
  gender?: CustomerGender;
  location?: string;
  createdAt: string;
}

/** Mirrors ConsentRecord (compliance/consent.service.ts). */
export interface ConsentRecord {
  id: string;
  tenantId: string;
  customerId: string;
  dataCategory: string;
  lawfulBasis: string;
  grantedAt: string;
  revokedAt?: string;
}

/** GET /customers/:tenantId/:customerId/activity's own shape — the ratings/
 * consentRecords half mirrors CustomerService.getActivity() exactly; the
 * sales/bookings half is folded in by CustomerController.activity() itself
 * (see its own comment on why that composition happens there, not inside
 * CustomerService). */
export interface CustomerActivity {
  customer: Customer;
  ratings: Rating[];
  consentRecords: ConsentRecord[];
  sales: SaleTransaction[];
  bookings: Booking[];
}

export type SaleSource = "manual" | "imported";

/** Added 2026-09-14 for real "daily shift-end banking" — see
 * ShiftBankingService's own top comment. Defaults to "cash" (this pilot's
 * most common real case) when the P.O.S. form doesn't set one explicitly. */
export type PaymentMethod = "cash" | "card" | "mobile_money" | "other";

export interface SaleLineItem {
  catalogItemId: string;
  /** Real free-text fallback for a line with no catalogItemId — see
   * RefundService's own `catalogItemId ?? description` keying comment. */
  description?: string;
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
  /** A real uploaded ad/promotional creative — same storage as
   * CatalogItem's own imageUrl. */
  adImageUrl?: string;
  /** Real push-to-channels history — set only by DealsApi.publish()'s own
   * endpoint, never directly. See deal.service.ts's own comment. */
  lastPublishedAt?: string;
  publishedChannels?: ("facebook" | "instagram")[];
  createdAt: string;
}

/** Mirrors QuotationLineItem(Input) (quotations/quotation.service.ts). */
export interface QuotationLineItemInput {
  catalogItemId?: string;
  description?: string;
  quantity: number;
  unitPrice: number;
}

export interface QuotationLineItem extends QuotationLineItemInput {
  id: string;
}

export type QuotationStatus = "draft" | "sent";

/** Mirrors Quotation (quotations/quotation.service.ts) — "let's add a
 * quotation module", the tenant's own explicit request (2026-09-16). */
export interface Quotation {
  id: string;
  tenantId: string;
  quoteNumber: string;
  customerId?: string;
  lineItems: QuotationLineItem[];
  subtotalAmount: number;
  discountAmount: number;
  totalAmount: number;
  notes?: string;
  /** "Have customer address" — the tenant's own explicit request
   * (2026-09-16). Free text, typed once per quotation — not auto-copied
   * from Customer.location (that field's own comment documents it as "a
   * town/area name, not a structured address"). */
  customerAddress?: string;
  validUntil?: string;
  status: QuotationStatus;
  createdByUserId?: string;
  createdAt: string;
  sentAt?: string;
  /** P2.2 — set once a quotation has genuinely been converted into a real
   * recorded Sale (QuotationsApi.convertToSale()). Never cleared once
   * set; not itself a QuotationStatus value. */
  convertedToSaleId?: string;
}

export type QuotationSendChannel = "email" | "whatsapp";

export interface QuotationSendResult {
  quotation: Quotation;
  results: { channel: QuotationSendChannel; status: "sent" | "skipped" | "failed"; reason?: string }[];
}

export interface QuotationConvertToSaleResult {
  quotation: Quotation;
  sale: SaleTransaction;
}

/** Mirrors Trigger/TriggerSeverity/TriggerStatus (triggers/trigger.service.ts)
 * — Phase 2 of the GrowthOS-aligned restructuring plan. `type` reuses the
 * backend's own NotificationType union (automation.service.ts) rather than
 * a separate frontend-only classification. */
export type TriggerSeverity = "critical" | "warning" | "info";
export type TriggerStatus = "open" | "actioned" | "dismissed";

export interface Trigger {
  id: string;
  tenantId: string;
  type: string;
  severity: TriggerSeverity;
  message: string;
  aboutCustomerId?: string;
  sourceModule: string;
  createdAt: string;
  status: TriggerStatus;
  actionedAt?: string;
}

/** Mirrors Goal/GoalPriority/GoalStatus (goals/goal.service.ts) — Phase 3
 * of the GrowthOS-aligned restructuring plan. `progressPct` is computed
 * server-side by GoalsController's own withProgress() wrapper on every
 * response — never sent by the client, never something this frontend
 * recomputes itself. */
export type GoalPriority = "low" | "medium" | "high";
export type GoalStatus = "on_track" | "at_risk" | "achieved" | "abandoned";
/** Mirrors GoalMetricType (goals/goal.service.ts) — which real,
 * already-computed KPI this goal tracks, if any. When set, the Goals page
 * can call GET /goals/:tenantId/:goalId/suggested-value to offer a real
 * suggested currentValue instead of the tenant guessing their own number. */
export type GoalMetricType = "sales_amount" | "conversion_rate" | "churn_rate" | "average_rating" | "nps_score";

export interface Goal {
  id: string;
  tenantId: string;
  objective: string;
  metric: string;
  metricType?: GoalMetricType;
  baselineValue: number;
  currentValue: number;
  targetValue: number;
  deadline: string;
  ownerUserId?: string;
  priority: GoalPriority;
  status: GoalStatus;
  createdAt: string;
  progressPct: number;
}

/** Mirrors GrowthAction/GrowthActionPriority/GrowthActionStatus
 * (growth-actions/growth-action.service.ts) — Phase 4 of the GrowthOS-aligned
 * restructuring plan. Distinct from GrowthActionsPage.tsx's four other,
 * DERIVED sections (bookings/ratings/NPS/audit plan) — this is the one
 * real, stateful task entity, either created manually or by converting a
 * Trigger. */
export type GrowthActionPriority = "low" | "medium" | "high";
export type GrowthActionStatus = "todo" | "in_progress" | "done" | "dismissed";

export interface GrowthAction {
  id: string;
  tenantId: string;
  title: string;
  reason: string;
  priority: GrowthActionPriority;
  expectedImpact: string;
  estimatedMinutes?: number;
  dueDate?: string;
  ownerUserId?: string;
  relatedGoalId?: string;
  relatedTriggerId?: string;
  status: GrowthActionStatus;
  result?: string;
  createdAt: string;
}

/** Mirrors Lead/LeadStage/CrmActivity/CrmActivityType (crm/crm.service.ts)
 * — Phase 5 of the GrowthOS-aligned restructuring plan, the biggest
 * net-new build in it: this codebase had no lead/opportunity/pipeline
 * concept before this phase. */
export type LeadStage = "new" | "qualified" | "proposal" | "negotiation" | "won" | "lost";

export interface Lead {
  id: string;
  tenantId: string;
  name: string;
  contactPhone?: string;
  contactEmail?: string;
  source: string;
  stage: LeadStage;
  estimatedValue?: number;
  ownerUserId?: string;
  createdAt: string;
  lastActivityAt: string;
  wonCustomerId?: string;
}

export type CrmActivityType = "note" | "call" | "whatsapp" | "meeting";

export interface CrmActivity {
  id: string;
  tenantId: string;
  leadId: string;
  type: CrmActivityType;
  body: string;
  createdAt: string;
  createdByUserId: string;
}

/** Mirrors CampaignChannel/CampaignLaunchResult/Campaign
 * (campaigns/campaign.service.ts) — see its own top comment for exactly
 * what launching each channel does and its two disclosed gaps (WhatsApp
 * needs a real approved template; the website link isn't yet fed back
 * into analytics). */
export type CampaignChannel = "facebook" | "instagram" | "whatsapp" | "website";

export interface CampaignLaunchResult {
  channel: CampaignChannel;
  status: "posted" | "sent" | "skipped" | "failed" | "info";
  detail?: string;
}

export interface Campaign {
  id: string;
  tenantId: string;
  name: string;
  dealId?: string;
  message?: string;
  channels: CampaignChannel[];
  lastLaunchedAt?: string;
  lastLaunchResults?: CampaignLaunchResult[];
  createdAt: string;
}

export interface SaleTransaction {
  id: string;
  tenantId: string;
  customerId?: string;
  recordedByUserId?: string;
  source: SaleSource;
  paymentMethod: PaymentMethod;
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
  /** Gross — unaffected by any refund. See `netSalesAmount` for the
   * figure with real refunds subtracted. */
  salesAmount: number;
  averageTransactionValue: number;
  totalUnits: number;
  unitsPerTransaction: number;
  addonRate: number;
  conversionRate: number | null;
  churnRate: number | null;
  /** Added 2026-09-15 at the tenant's own request ("Rating 5, NPS 10" as
   * benchmarkable targets) — see kpi-benchmark.service.ts's KPI_UNIT for
   * exactly what each scale means. */
  averageRating: number | null;
  averageNpsScore: number | null;
  /** Added 2026-09-12 alongside real refund/exchange processing — real
   * money refunded to customers within this period (sales.controller.ts's
   * own `kpis()` combines SaleService's gross figure with
   * RefundService's own real total, not a single service computing both). */
  refundedAmount: number;
  /** salesAmount − refundedAmount — the real net figure, never fabricated
   * as a fixed percentage of gross. */
  netSalesAmount: number;
}

/** Mirrors RefundLineItemInput/SaleRefund in refund.service.ts. See that
 * file's own top comment for why "exchange" isn't a separate backend
 * concept — this SPA composes a refund (this type) with an ordinary new
 * SaleTransaction to build one on the P.O.S. page. */
export interface RefundLineItemInput {
  catalogItemId?: string;
  description?: string;
  quantity: number;
  unitPrice: number;
}

export interface SaleRefund {
  id: string;
  tenantId: string;
  saleId: string;
  reason?: string;
  refundAmount: number;
  lineItems: RefundLineItemInput[];
  recordedByUserId?: string;
  createdAt: string;
}

/** Mirrors ShiftBanking (sales/shift-banking.service.ts) — see its own top
 * comment for exactly what each field means, including the one disclosed
 * simplification in how `expectedCashAmount` nets refunds. `variance` is
 * added by SalesController.listShiftBanking() itself (computed, never
 * stored) — present on list results, not on the raw closeShift() response. */
/** The exact fixed set of note/coin denominations this platform recognizes
 * — mirrors DENOMINATIONS in shift-banking.service.ts. */
export const DENOMINATIONS = ["0.10", "0.20", "0.50", "1.00", "2.00", "5.00", "10.00", "20.00", "50.00", "100.00", "200.00"] as const;
export type Denomination = (typeof DENOMINATIONS)[number];

export interface ShiftBanking {
  id: string;
  tenantId: string;
  periodStart: string;
  periodEnd: string;
  expectedCashAmount: number;
  countedCashAmount: number;
  denominationCounts?: Partial<Record<Denomination, number>>;
  bankedAmount: number;
  notes?: string;
  recordedByUserId?: string;
  createdAt: string;
  variance?: number;
}

/** Mirrors PettyCashTransaction in petty-cash.service.ts. */
export type PettyCashTransactionType = "replenishment" | "vendor_payment";

export interface PettyCashTransaction {
  id: string;
  tenantId: string;
  vendorId?: string;
  type: PettyCashTransactionType;
  amount: number;
  description?: string;
  recordedByUserId?: string;
  occurredAt: string;
}

/** Mirrors Vendor in vendor.service.ts. */
export interface Vendor {
  id: string;
  tenantId: string;
  name: string;
  contactInfo?: string;
  isActive: boolean;
  createdAt: string;
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

/** Mirrors RetentionCustomer/RetentionSummary (retention/retention.service.ts)
 * — Phase 6 of the GrowthOS-aligned restructuring plan. Read-only:
 * nothing on this page is written back through this type. */
export interface RetentionCustomer {
  customerId: string;
  displayName?: string;
  phone?: string;
  email?: string;
  lastPurchaseAt: string;
  daysSinceLastPurchase: number;
  totalPurchases: number;
}

export interface RetentionSummary {
  atRiskThresholdDays: number;
  inactiveThresholdDays: number;
  atRisk: RetentionCustomer[];
  inactive: RetentionCustomer[];
  reactivationCandidates: RetentionCustomer[];
  repeatRate: RepeatRateResult;
}

export interface SalesTarget {
  id: string;
  tenantId: string;
  userId?: string;
  periodStart: string;
  periodEnd: string;
  targetAmount: number;
  createdAt: string;
  /** Added 2026-09-15 ("sales target on %") — SalesController.listTargets()
   * computes both fresh against SaleService's own real KPIs for this
   * target's exact period, never stored. actualAmount can exceed
   * targetAmount (a beaten target); progressPct is null only when
   * targetAmount is zero/negative, where "% of target" is meaningless. */
  actualAmount: number;
  progressPct: number | null;
}

export type BenchmarkKpi =
  | "sales_amount"
  | "conversion_rate"
  | "avg_transaction_value"
  | "units_per_transaction"
  | "transactional_volume"
  | "addon_rate"
  | "churn_rate"
  | "average_rating"
  | "nps_score";

export type BenchmarkComparison = "above" | "below";

/** Mirrors BenchmarkKpiUnit in kpi-benchmark.service.ts — drives the
 * threshold input's bounds/suffix in BenchmarkForm below. */
export type BenchmarkKpiUnit = "percent" | "rating_5" | "nps_10" | "number";

/** Mirrors BenchmarkCadence in kpi-benchmark.service.ts — "targets must be
 * set for daily and continues", the tenant's own explicit request
 * (2026-09-15). */
export type BenchmarkCadence = "custom" | "daily" | "continuous";

export interface KpiBenchmark {
  id: string;
  tenantId: string;
  userId?: string;
  kpi: BenchmarkKpi;
  comparison: BenchmarkComparison;
  thresholdValue: number;
  cadence: BenchmarkCadence;
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

/** Mirrors SalesTrendPoint in sale.service.ts — one point per calendar
 * day, zero-filled on days with no sales rather than omitted. */
export interface SalesTrendPoint {
  date: string;
  salesAmount: number;
  transactionCount: number;
}

/** Mirrors ProductContribution in sale.service.ts. `revenue` is GROSS
 * per-line-item revenue; `catalogItemId: null` is the "no catalog item"
 * rollup bucket, not a missing value. */
export interface ProductContribution {
  catalogItemId: string | null;
  name: string;
  revenue: number;
  unitsSold: number;
  share: number;
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

/** Mirrors SocialMetricsResult (social-publishing/social-metrics.service.ts)
 * exactly — every field can independently be `null` with a real reason in
 * `unavailable`, never a fabricated 0. Embedded in BusinessSnapshot below;
 * MarketingInsightsPage.tsx is its other real consumer. */
export interface SocialMetricsResult {
  connected: boolean;
  pageName: string | null;
  facebook: {
    followers: number | null;
    impressions: number | null;
    views: number | null;
    messageThreads: number | null;
    likes: number;
    comments: number;
    shares: number;
    postsInPeriod: number;
  } | null;
  instagram: {
    connected: boolean;
    followers: number | null;
    views: number | null;
    likes: number;
    comments: number;
    shares: number;
    postsInPeriod: number;
  } | null;
  unavailable: Record<string, string>;
}

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
  /** Phase 8 of the GrowthOS-aligned restructuring plan — see
   * onboarding.service.ts's own OnboardingStatus.isFirstRun comment for
   * why this is a real, narrower gate than the checklist above (only
   * Goal + Growth Audit, not all six steps). */
  isFirstRun: boolean;
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
  /** Phase 7 of the GrowthOS-aligned restructuring plan — real open
   * Triggers merged with real high-priority open Growth Actions, sorted
   * severity-then-recency, capped for display. See snapshot.service.ts's
   * own SnapshotPriorityItem comment. */
  priorities: { severity: "critical" | "warning" | "info"; label: string; link: string }[];
  /** P1.3 of "ACTION PROPOSED ADDITIONS IN PRIORITY ORDER" — real, open
   * (not achieved/abandoned) Goal progress, soonest deadline first, capped
   * for display. See snapshot.service.ts's own SnapshotGoalSummary
   * comment; the full list (including achieved/abandoned) lives on
   * /goals. */
  goals: { id: string; objective: string; progressPct: number; status: GoalStatus; deadline: string }[];
  /** The real "sales graph" — one point per day across `period` above,
   * zero-filled. See sale.service.ts's own SalesTrendPoint comment. */
  salesTrend: SalesTrendPoint[];
  /** Real per-product/service revenue contribution across `period` —
   * gross revenue (this schema doesn't itemize discounts per line). */
  productContribution: ProductContribution[];
  /** Real-time daily monitoring, always scoped to TODAY regardless of
   * `period` above — added 2026-09-12 at the tenant's own request for an
   * hourly view of today against a real daily budget. */
  dailyMonitoring: {
    date: string;
    hourlyTrend: { hour: number; salesAmount: number; transactionCount: number }[];
    budget: number | null;
    actual: number;
    lastYearActual: number;
  };
  socialMetrics: SocialMetricsResult;
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

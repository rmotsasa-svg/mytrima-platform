import { apiRequest, uploadImage, API_BASE_URL } from "./client";
import type {
  AnalyticsSummary,
  BenchmarkComparison,
  BenchmarkKpi,
  Booking,
  BusinessProfileInput,
  BusinessSnapshot,
  Campaign,
  CampaignChannel,
  CatalogItem,
  CrmActivity,
  CrmActivityType,
  Customer,
  CustomerGender,
  CustomerActivity,
  CustomerLifetimeValueResult,
  Deal,
  Denomination,
  DiscountType,
  Goal,
  GoalPriority,
  GoalStatus,
  GrowthAction,
  GrowthActionPriority,
  GrowthActionStatus,
  GrowthAuditAnswers,
  GrowthAuditQuestions,
  GrowthAuditResponse,
  ItemType,
  KpiBenchmark,
  Lead,
  LeadStage,
  MfaEnrollStartResult,
  NpsAggregate,
  NpsResponse,
  OnboardingStatus,
  Page,
  PaymentMethod,
  PettyCashTransaction,
  Rating,
  RatingAggregate,
  RatingStatus,
  RecommendationResult,
  RefundLineItemInput,
  RepeatRateResult,
  RetentionSummary,
  Role,
  SaleRefund,
  SaleTransaction,
  SalesKpis,
  SalesTarget,
  ShiftBanking,
  SocialConnectionStatus,
  StaffActivityLogEntry,
  StaffProfile,
  SupportTicket,
  SupportTicketSeverity,
  TenantProfile,
  TokenPair,
  Trigger,
  TriggerStatus,
  Vendor,
} from "./types";

export interface MfaEnrollmentRequiredResponse {
  mfaEnrollmentRequired: true;
  enrollmentToken: string;
}

export type LoginResponse = TokenPair | MfaEnrollmentRequiredResponse;

export function isMfaEnrollmentRequired(res: LoginResponse): res is MfaEnrollmentRequiredResponse {
  return (res as MfaEnrollmentRequiredResponse).mfaEnrollmentRequired === true;
}

export const AuthApi = {
  login(tenantId: string, email: string, password: string, totpCode?: string) {
    return apiRequest<LoginResponse>("/auth/login", { method: "POST", anonymous: true, body: { tenantId, email, password, totpCode } });
  },
  logout(refreshToken: string) {
    return apiRequest<{ loggedOut: boolean }>("/auth/logout", { method: "POST", anonymous: true, body: { refreshToken } });
  },
  /** signupCode is optional since self-serve signup opened 2026-09-11 (see
   * the backend's tenant.service.ts "DELIBERATE POLICY CHANGE" comment) —
   * only meaningful if this deployment has re-enabled invite-only mode by
   * setting TENANT_SIGNUP_CODE. */
  registerTenant(tenantName: string, ownerEmail: string, ownerPassword: string, signupCode?: string) {
    return apiRequest<{ tenantId: string; owner: { id: string; email: string; emailVerified: boolean } }>("/auth/tenants", {
      method: "POST",
      anonymous: true,
      body: { signupCode, tenantName, ownerEmail, ownerPassword },
    });
  },
  /** Confirms the link a self-serve owner was just emailed — see
   * VerifyEmailPage.tsx.
   *
   * REAL BUG found live-testing self-serve signup end to end (2026-09-14):
   * this type omitted `tenantId`, even though the backend's real response
   * (AuthService.verifyEmailAddress() returns a full PublicAuthUserRecord,
   * which has always included it — auth.service.ts's own interface) sends
   * it every time. VerifyEmailPage.tsx couldn't read a field TypeScript
   * said didn't exist, so it never had the chance to show the one piece of
   * information LoginPage.tsx's "Tenant ID" field actually needs. */
  verifyEmail(token: string) {
    return apiRequest<{ id: string; tenantId: string; email: string; emailVerified: boolean }>("/auth/verify-email", {
      method: "POST",
      anonymous: true,
      body: { token },
    });
  },
  /** Always resolves with the same generic message regardless of whether
   * the account exists or was already verified — see the backend's
   * AuthService.resendVerificationToken()'s own comment on why. */
  resendVerificationEmail(tenantId: string, email: string) {
    return apiRequest<{ message: string }>("/auth/verify-email/resend", { method: "POST", anonymous: true, body: { tenantId, email } });
  },
  /** Uses the short-lived enrollmentToken as a real Bearer token — the
   * backend's MfaEnrollmentOrAccessTokenGuard accepts either kind (see
   * auth.service.ts's verifyAccessOrMfaEnrollmentToken()). apiRequest's own
   * Authorization header only ever sends the *access* token, so this
   * bypasses that and sets the header directly for these two calls only. */
  async startMfaEnrollment(enrollmentToken: string) {
    return rawBearerRequest<MfaEnrollStartResult>("/auth/mfa/enroll/start", enrollmentToken, { method: "POST" });
  },
  async confirmMfaEnrollment(enrollmentToken: string, code: string) {
    return rawBearerRequest<{ mfaEnabled: boolean }>("/auth/mfa/enroll/confirm", enrollmentToken, { method: "POST", body: { code } });
  },
};

export const TenantApi = {
  /** REAL GAP closed 2026-09-11 — before this, GET /auth/tenants/me didn't
   * exist anywhere: TenantService.getById() was used internally only, so
   * this SPA's Settings page had to infer "Set"/"Not set" from the
   * onboarding checklist's booleans instead of the actual stored value. */
  getMe() {
    return apiRequest<TenantProfile>("/auth/tenants/me");
  },
  setBusinessProfile(profile: BusinessProfileInput) {
    return apiRequest<{ success: boolean }>("/auth/tenants/business-profile", { method: "PATCH", body: profile });
  },
};

async function rawBearerRequest<T>(path: string, bearerToken: string, opts: { method: string; body?: unknown }): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method: opts.method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${bearerToken}` },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  const parsed = text ? JSON.parse(text) : undefined;
  if (!res.ok) {
    const message = Array.isArray(parsed?.message) ? parsed.message.join("; ") : parsed?.message ?? res.statusText;
    throw new Error(message);
  }
  return parsed as T;
}

export const StaffApi = {
  me() {
    return apiRequest<StaffProfile>("/staff/me");
  },
  changeOwnPassword(currentPassword: string, newPassword: string) {
    return apiRequest<{ passwordChanged: boolean }>("/staff/me/change-password", { method: "POST", body: { currentPassword, newPassword } });
  },
  list() {
    return apiRequest<StaffProfile[]>("/staff");
  },
  changeRole(userId: string, role: Role) {
    return apiRequest<StaffProfile>(`/staff/${userId}/role`, { method: "PATCH", body: { role } });
  },
  deactivate(userId: string) {
    return apiRequest<StaffProfile>(`/staff/${userId}/deactivate`, { method: "POST" });
  },
  reactivate(userId: string) {
    return apiRequest<StaffProfile>(`/staff/${userId}/reactivate`, { method: "POST" });
  },
  registerStaff(email: string, password: string, role: Role, firstName?: string, lastName?: string) {
    return apiRequest<StaffProfile>("/auth/register", { method: "POST", body: { email, password, role, firstName, lastName } });
  },
  /** Real PATCH semantics — see AuthService.updateProfile()'s own comment.
   * `updateOwnProfile` (PATCH /staff/me) needs no permission beyond being
   * authenticated; `updateProfile` (PATCH /staff/:userId) is an owner/
   * manager editing a teammate's name, gated by `user:manage`. */
  updateOwnProfile(firstName?: string, lastName?: string) {
    return apiRequest<StaffProfile>("/staff/me", { method: "PATCH", body: { firstName, lastName } });
  },
  updateProfile(userId: string, firstName?: string, lastName?: string) {
    return apiRequest<StaffProfile>(`/staff/${userId}`, { method: "PATCH", body: { firstName, lastName } });
  },
  /** "Add staff activities history" — see StaffController.activity()'s own
   * comment for exactly who may view whose. */
  activity(userId: string) {
    return apiRequest<StaffActivityLogEntry[]>(`/staff/${userId}/activity`);
  },
};

export const SnapshotApi = {
  get(tenantId: string, periodStart?: string, periodEnd?: string) {
    return apiRequest<BusinessSnapshot>(`/reports/${tenantId}/snapshot`, { query: { periodStart, periodEnd } });
  },
};

export const GrowthAuditApi = {
  questions() {
    return apiRequest<GrowthAuditQuestions>("/growth-audit/questions");
  },
  submit(answers: GrowthAuditAnswers) {
    return apiRequest<{ result: GrowthAuditResponse["result"]; notifications: unknown[] }>("/growth-audit", { method: "POST", body: { answers } });
  },
  list(tenantId: string) {
    return apiRequest<GrowthAuditResponse[]>(`/growth-audit/${tenantId}`);
  },
  recommendations(tenantId: string) {
    return apiRequest<RecommendationResult>(`/growth-audit/${tenantId}/recommendations`);
  },
};

export const RatingsApi = {
  /** GET /ratings/:tenantId — added to the backend 2026-09-11 alongside
   * this page: RatingService.findAllForTenant() already existed (used
   * internally by Snapshot/Recommendation) but had no HTTP route, so there
   * was previously no way for a tenant to see individual ratings at all,
   * only the public-only aggregate below. */
  list(tenantId: string) {
    return apiRequest<Rating[]>(`/ratings/${tenantId}`);
  },
  aggregate(tenantId: string) {
    return apiRequest<RatingAggregate>(`/ratings/${tenantId}/aggregate`);
  },
  /** Only "public"/"hidden" are valid moderation targets — the backend's
   * own moderate() throws InvalidRatingError on anything else (a rating
   * starts "pending" on its own, never moderated back into it). */
  moderate(ratingId: string, status: Extract<RatingStatus, "public" | "hidden">) {
    return apiRequest<{ moderated: boolean }>(`/ratings/${ratingId}/moderate`, { method: "POST", body: { status } });
  },
  /** POST /ratings — deliberately unauthenticated on the backend (a
   * customer submitting a rating is not a Mytrima account holder), so
   * `anonymous: true` here matches: no stale Authorization header from
   * whatever account this browser happens to be logged into, and no
   * refresh-and-retry on a 401 (there is no session to refresh). The only
   * caller is FeedbackPage.tsx. */
  submit(tenantId: string, customerId: string, stars: number, comment?: string) {
    return apiRequest<Rating>("/ratings", { method: "POST", anonymous: true, body: { tenantId, customerId, stars, comment } });
  },
};

export const NpsApi = {
  /** GET /nps/:tenantId — same real gap, same fix, added the same day. */
  list(tenantId: string) {
    return apiRequest<NpsResponse[]>(`/nps/${tenantId}`);
  },
  aggregate(tenantId: string) {
    return apiRequest<NpsAggregate>(`/nps/${tenantId}/aggregate`);
  },
  /** POST /nps — same unauthenticated reasoning as RatingsApi.submit()
   * above. Only caller: FeedbackPage.tsx. */
  submit(tenantId: string, customerId: string, score: number, comment?: string) {
    return apiRequest<{ category: string; needsFollowUp: boolean }>("/nps", { method: "POST", anonymous: true, body: { tenantId, customerId, score, comment } });
  },
};

export const OnboardingApi = {
  get(tenantId: string) {
    return apiRequest<OnboardingStatus>(`/onboarding/${tenantId}`);
  },
};

export const SettingsApi = {
  setNotificationPhone(notificationPhoneE164: string) {
    return apiRequest<{ success: boolean }>("/auth/tenants/notification-phone", { method: "PATCH", body: { notificationPhoneE164 } });
  },
  setPayfastMerchantId(tenantId: string, payfastMerchantId: string) {
    return apiRequest<{ success: boolean }>(`/payments/${tenantId}/merchant-id`, { method: "POST", body: { payfastMerchantId } });
  },
  getSocialConnection(tenantId: string) {
    return apiRequest<SocialConnectionStatus>(`/social/${tenantId}/connection`);
  },
  /** Not a fetch — GET /social/:tenantId/connect 302s straight to Facebook's
   * own OAuth dialog (see meta-oauth.service.ts's buildAuthorizationUrl()),
   * so the SPA just needs the real URL to send the browser to, same as any
   * other "continue with X" button. Built from API_BASE_URL, not a route on
   * this app — the backend is what redirects, not this SPA. */
  connectFacebookUrl(tenantId: string) {
    return `${API_BASE_URL}/social/${tenantId}/connect`;
  },
};

export const SalesApi = {
  list(tenantId: string, limit = 50, offset = 0) {
    return apiRequest<Page<SaleTransaction>>(`/sales/${tenantId}`, { query: { limit, offset } });
  },
  record(
    tenantId: string,
    body: {
      customerId?: string;
      dealId?: string;
      paymentMethod?: PaymentMethod;
      lineItems: { catalogItemId: string; quantity: number; unitPrice: number; discountAmount?: number }[];
    }
  ) {
    return apiRequest<SaleTransaction>(`/sales/${tenantId}`, { method: "POST", body });
  },
  kpis(tenantId: string, periodStart?: string, periodEnd?: string) {
    return apiRequest<SalesKpis>(`/sales/${tenantId}/kpis`, { query: { periodStart, periodEnd } });
  },
  /** Real refund/exchange processing — see refund.service.ts's own top
   * comment for why "exchange" is composed on this page (a refund plus an
   * ordinary record()), not a separate backend concept. */
  recordRefund(tenantId: string, saleId: string, lineItems: RefundLineItemInput[], reason?: string) {
    return apiRequest<SaleRefund>(`/sales/${tenantId}/${saleId}/refund`, { method: "POST", body: { lineItems, reason } });
  },
  listRefunds(tenantId: string, saleId: string) {
    return apiRequest<SaleRefund[]>(`/sales/${tenantId}/${saleId}/refunds`);
  },
  repeatRate(tenantId: string, periodStart?: string, periodEnd?: string) {
    return apiRequest<RepeatRateResult>(`/sales/${tenantId}/repeat-rate`, { query: { periodStart, periodEnd } });
  },
  /** No period params — see sale.service.ts's own comment on why
   * "lifetime" isn't a date-range concept. Genuinely nullable: the
   * backend returns `null` until at least one named customer has a
   * SECOND purchase (a lifespan needs two dates to span) — a real "not
   * enough data yet" answer, not a fabricated zero. */
  lifetimeValue(tenantId: string) {
    return apiRequest<CustomerLifetimeValueResult | null>(`/sales/${tenantId}/lifetime-value`);
  },
  listTargets(tenantId: string) {
    return apiRequest<SalesTarget[]>(`/sales/${tenantId}/targets`);
  },
  setTarget(tenantId: string, periodStart: string, periodEnd: string, targetAmount: number) {
    return apiRequest<SalesTarget>(`/sales/${tenantId}/targets`, { method: "POST", body: { periodStart, periodEnd, targetAmount } });
  },
  listBenchmarks(tenantId: string) {
    return apiRequest<KpiBenchmark[]>(`/sales/${tenantId}/benchmarks`);
  },
  setBenchmark(
    tenantId: string,
    kpi: BenchmarkKpi,
    comparison: BenchmarkComparison,
    thresholdValue: number,
    periodStart: string,
    periodEnd: string
  ) {
    return apiRequest<KpiBenchmark>(`/sales/${tenantId}/benchmarks`, { method: "POST", body: { kpi, comparison, thresholdValue, periodStart, periodEnd } });
  },
};

/** "Allow staff to do daily shift end banking" — see
 * ShiftBankingService's own top comment for exactly what `expectedCash`
 * means (real cash sales minus refunds in the period, snapshotted at
 * close time) and its one disclosed simplification. */
export const ShiftBankingApi = {
  expectedCash(tenantId: string, periodStart: string, periodEnd: string) {
    return apiRequest<{ expectedCashAmount: number }>(`/sales/${tenantId}/shift-banking/expected-cash`, { query: { periodStart, periodEnd } });
  },
  closeShift(
    tenantId: string,
    body: {
      periodStart: string;
      periodEnd: string;
      countedCashAmount: number;
      bankedAmount: number;
      notes?: string;
      denominationCounts?: Partial<Record<Denomination, number>>;
    }
  ) {
    return apiRequest<ShiftBanking>(`/sales/${tenantId}/shift-banking`, { method: "POST", body });
  },
  list(tenantId: string) {
    return apiRequest<ShiftBanking[]>(`/sales/${tenantId}/shift-banking`);
  },
  /** "Allow staff to send slips on WhatsApp or email" — see
   * SalesController.sendShiftBankingSlip()'s own comment for exactly what
   * the slip contains and the one disclosed WhatsApp-template gap. */
  sendSlip(tenantId: string, shiftBankingId: string, channel: "email" | "whatsapp", recipient: string) {
    return apiRequest<{ sent: true }>(`/sales/${tenantId}/shift-banking/${shiftBankingId}/send-slip`, {
      method: "POST",
      body: { channel, recipient },
    });
  },
};

export const CatalogApi = {
  list(tenantId: string) {
    return apiRequest<CatalogItem[]>(`/catalog/${tenantId}`);
  },
  create(tenantId: string, body: { name: string; itemType: ItemType; unitPrice: number; sku?: string; durationMinutes?: number }) {
    return apiRequest<CatalogItem>(`/catalog/${tenantId}`, { method: "POST", body });
  },
  update(tenantId: string, itemId: string, body: Partial<{ name: string; unitPrice: number; isActive: boolean; sku?: string; durationMinutes?: number }>) {
    return apiRequest<CatalogItem>(`/catalog/${tenantId}/${itemId}`, { method: "PATCH", body });
  },
  uploadImage(tenantId: string, itemId: string, file: File) {
    return uploadImage<CatalogItem>(`/catalog/${tenantId}/${itemId}/image`, file);
  },
};

export const DealsApi = {
  list(tenantId: string) {
    return apiRequest<Deal[]>(`/deals/${tenantId}`);
  },
  create(
    tenantId: string,
    body: {
      name: string;
      discountType: DiscountType;
      catalogItemIds: string[];
      percentageOff?: number;
      buyQuantity?: number;
      freeQuantity?: number;
      fixedAmountOff?: number;
      startsAt?: string;
      endsAt?: string;
    }
  ) {
    return apiRequest<Deal>(`/deals/${tenantId}`, { method: "POST", body });
  },
  update(
    tenantId: string,
    dealId: string,
    body: Partial<{
      name: string;
      discountType: DiscountType;
      catalogItemIds: string[];
      percentageOff?: number;
      buyQuantity?: number;
      freeQuantity?: number;
      fixedAmountOff?: number;
      /** Explicit `null` clears the date; omitted keeps the existing value —
       * mirrors DealService.update()'s own PATCH semantics. */
      startsAt?: string | null;
      endsAt?: string | null;
      isActive?: boolean;
    }>
  ) {
    return apiRequest<Deal>(`/deals/${tenantId}/${dealId}`, { method: "PATCH", body });
  },
  uploadImage(tenantId: string, dealId: string, file: File) {
    return uploadImage<Deal>(`/deals/${tenantId}/${dealId}/image`, file);
  },
  publish(tenantId: string, dealId: string, message?: string) {
    return apiRequest<{ message: string; results: { channel: string; status: "posted" | "skipped" | "failed"; postId?: string; reason?: string }[] }>(
      `/deals/${tenantId}/${dealId}/publish`,
      { method: "POST", body: { message } }
    );
  },
};

/** Phase 6 of the GrowthOS-aligned restructuring plan — see
 * retention.controller.ts's own comment. Read-only: no write method
 * exists here at all. */
export const RetentionApi = {
  summary(tenantId: string) {
    return apiRequest<RetentionSummary>(`/retention/${tenantId}`);
  },
};

/** Phase 5 of the GrowthOS-aligned restructuring plan — see
 * crm.controller.ts's own comment. Moving a lead to "won" may match or
 * create a real Customer server-side (CrmService.moveStage()) — this API
 * layer doesn't duplicate that decision, it just returns the updated
 * Lead, which carries the real wonCustomerId once set. */
export const CrmApi = {
  list(tenantId: string) {
    return apiRequest<Lead[]>(`/leads/${tenantId}`);
  },
  create(tenantId: string, body: { name: string; contactPhone?: string; contactEmail?: string; source: string; estimatedValue?: number }) {
    return apiRequest<Lead>(`/leads/${tenantId}`, { method: "POST", body });
  },
  moveStage(tenantId: string, leadId: string, stage: LeadStage) {
    return apiRequest<Lead>(`/leads/${tenantId}/${leadId}/stage`, { method: "PATCH", body: { stage } });
  },
  logActivity(tenantId: string, leadId: string, type: CrmActivityType, body: string) {
    return apiRequest<CrmActivity>(`/leads/${tenantId}/${leadId}/activities`, { method: "POST", body: { type, body } });
  },
  listActivities(tenantId: string, leadId: string) {
    return apiRequest<CrmActivity[]>(`/leads/${tenantId}/${leadId}/activities`);
  },
};

/** Phase 4 of the GrowthOS-aligned restructuring plan — see
 * growth-actions.controller.ts's own comment. `status` omitted means every
 * action regardless of status; GrowthActionsPage.tsx applies its own
 * default rather than this API layer picking one. */
export const GrowthActionsApi = {
  list(tenantId: string, status?: GrowthActionStatus) {
    return apiRequest<GrowthAction[]>(`/growth-actions/${tenantId}`, { query: { status } });
  },
  create(
    tenantId: string,
    body: { title: string; reason: string; priority: GrowthActionPriority; expectedImpact: string; estimatedMinutes?: number; dueDate?: string }
  ) {
    return apiRequest<GrowthAction>(`/growth-actions/${tenantId}`, { method: "POST", body });
  },
  update(
    tenantId: string,
    actionId: string,
    body: Partial<{
      title: string;
      reason: string;
      priority: GrowthActionPriority;
      expectedImpact: string;
      estimatedMinutes: number;
      dueDate: string;
      status: GrowthActionStatus;
      result: string;
    }>
  ) {
    return apiRequest<GrowthAction>(`/growth-actions/${tenantId}/${actionId}`, { method: "PATCH", body });
  },
};

/** Phase 3 of the GrowthOS-aligned restructuring plan — see
 * goals.controller.ts's own comment. Every response already carries a
 * real, server-computed `progressPct` (GoalsController's withProgress()) —
 * nothing here recomputes it. */
export const GoalsApi = {
  list(tenantId: string) {
    return apiRequest<Goal[]>(`/goals/${tenantId}`);
  },
  create(
    tenantId: string,
    body: { objective: string; metric: string; baselineValue: number; targetValue: number; deadline: string; ownerUserId?: string; priority: GoalPriority }
  ) {
    return apiRequest<Goal>(`/goals/${tenantId}`, { method: "POST", body });
  },
  update(
    tenantId: string,
    goalId: string,
    body: Partial<{
      objective: string;
      metric: string;
      currentValue: number;
      targetValue: number;
      deadline: string;
      ownerUserId: string;
      priority: GoalPriority;
      status: GoalStatus;
    }>
  ) {
    return apiRequest<Goal>(`/goals/${tenantId}/${goalId}`, { method: "PATCH", body });
  },
};

/** Phase 2 of the GrowthOS-aligned restructuring plan — see
 * triggers.controller.ts's own comment. `status` omitted means every
 * trigger regardless of status; TriggersPage.tsx applies its own default
 * ("open" only) rather than this API layer picking one. */
export const TriggersApi = {
  list(tenantId: string, status?: TriggerStatus) {
    return apiRequest<Trigger[]>(`/triggers/${tenantId}`, { query: { status } });
  },
  dismiss(tenantId: string, triggerId: string) {
    return apiRequest<Trigger>(`/triggers/${tenantId}/${triggerId}/dismiss`, { method: "POST" });
  },
  /** Real as of Phase 4 — returns the trigger (now `actioned`) AND the
   * real GrowthAction TriggerService.convertToAction() created from it.
   * Before Phase 4 this returned just the trigger; that Phase 2 stub is
   * gone now, not just relabeled. */
  convertToAction(tenantId: string, triggerId: string) {
    return apiRequest<{ trigger: Trigger; growthAction: GrowthAction }>(`/triggers/${tenantId}/${triggerId}/convert-to-action`, { method: "POST" });
  },
};

/** "Add campaign set for Facebook, WhatsApp, Instagram and Website" — see
 * CampaignsController's own comment for exactly what launching each
 * channel does, including its two disclosed gaps (WhatsApp needs a real
 * approved template; the website link isn't yet fed into analytics). */
export const CampaignsApi = {
  list(tenantId: string) {
    return apiRequest<Campaign[]>(`/campaigns/${tenantId}`);
  },
  create(tenantId: string, body: { name: string; dealId?: string; message?: string; channels: CampaignChannel[] }) {
    return apiRequest<Campaign>(`/campaigns/${tenantId}`, { method: "POST", body });
  },
  launch(tenantId: string, campaignId: string) {
    return apiRequest<Campaign>(`/campaigns/${tenantId}/${campaignId}/launch`, { method: "POST" });
  },
};

export const VendorsApi = {
  list(tenantId: string) {
    return apiRequest<Vendor[]>(`/vendors/${tenantId}`);
  },
  create(tenantId: string, name: string, contactInfo?: string) {
    return apiRequest<Vendor>(`/vendors/${tenantId}`, { method: "POST", body: { name, contactInfo } });
  },
};

export const PettyCashApi = {
  /** The ledger plus its own live-computed running balance, in one
   * response — see petty-cash.controller.ts's own comment: the balance is
   * never stored, always derived fresh from the ledger. */
  ledger(tenantId: string) {
    return apiRequest<{ transactions: PettyCashTransaction[]; balance: number }>(`/petty-cash/${tenantId}`);
  },
  replenish(tenantId: string, amount: number, description?: string) {
    return apiRequest<PettyCashTransaction>(`/petty-cash/${tenantId}/replenish`, { method: "POST", body: { amount, description } });
  },
  payVendor(tenantId: string, vendorId: string, amount: number, description?: string) {
    return apiRequest<PettyCashTransaction>(`/petty-cash/${tenantId}/pay-vendor`, { method: "POST", body: { vendorId, amount, description } });
  },
};

export const CustomersApi = {
  list(tenantId: string, q?: string) {
    return apiRequest<Customer[]>(`/customers/${tenantId}`, { query: { q } });
  },
  create(body: { displayName?: string; phone?: string; email?: string; gender?: CustomerGender; location?: string }) {
    return apiRequest<Customer>("/customers", { method: "POST", body });
  },
  update(tenantId: string, customerId: string, body: Partial<{ displayName: string; phone: string; email: string; gender: CustomerGender | ""; location: string }>) {
    return apiRequest<Customer>(`/customers/${tenantId}/${customerId}`, { method: "PATCH", body });
  },
  /** The "customer 360" view — see CustomerController.activity()'s own
   * comment for exactly what's real here (ratings, consent, and now real
   * sales/booking history) and what's deliberately not (conversation
   * history, merge — see customer.service.ts's own top comment). */
  activity(tenantId: string, customerId: string) {
    return apiRequest<CustomerActivity>(`/customers/${tenantId}/${customerId}/activity`);
  },
  /** "Request rating/NPS through WhatsApp or email" — see
   * CustomerController.requestFeedback()'s own comment for exactly what's
   * real here (email always; WhatsApp only once a real approved template
   * is configured) and what each per-channel result actually means. */
  requestFeedback(tenantId: string, customerId: string, channels: ("email" | "whatsapp")[]) {
    return apiRequest<{ requestUrl: string; results: { channel: string; status: "sent" | "skipped" | "failed"; reason?: string }[] }>(
      `/customers/${tenantId}/${customerId}/request-feedback`,
      { method: "POST", body: { channels } }
    );
  },
  /** "Send bulk NPS/rating to all customers" — see
   * CustomerController.requestFeedbackBulk()'s own comment for exactly
   * what's real here: the same per-customer send/skip/fail logic as
   * requestFeedback() above, looped sequentially, returning per-channel
   * counts (not a per-customer breakdown) plus up to 20 real failure
   * details. */
  requestFeedbackBulk(tenantId: string, channels: ("email" | "whatsapp")[]) {
    return apiRequest<{
      totalCustomers: number;
      results: { channel: string; sent: number; skipped: number; failed: number }[];
      failures: { customerId: string; channel: string; reason: string }[];
    }>(`/customers/${tenantId}/request-feedback-bulk`, { method: "POST", body: { channels } });
  },
};

export const BookingsApi = {
  list(tenantId: string) {
    return apiRequest<Booking[]>(`/bookings/${tenantId}`);
  },
  /** Staff booking a customer in directly — see BookingController's own
   * comment on why this starts "confirmed", not "requested". */
  createByStaff(tenantId: string, body: { customerId: string; catalogItemId: string; scheduledAt: string; durationMinutes?: number; notes?: string }) {
    return apiRequest<Booking>(`/bookings/${tenantId}/staff`, { method: "POST", body });
  },
  confirm(tenantId: string, bookingId: string) {
    return apiRequest<Booking>(`/bookings/${tenantId}/${bookingId}/confirm`, { method: "POST" });
  },
  cancel(tenantId: string, bookingId: string) {
    return apiRequest<Booking>(`/bookings/${tenantId}/${bookingId}/cancel`, { method: "POST" });
  },
  complete(tenantId: string, bookingId: string) {
    return apiRequest<Booking>(`/bookings/${tenantId}/${bookingId}/complete`, { method: "POST" });
  },
  markNoShow(tenantId: string, bookingId: string) {
    return apiRequest<Booking>(`/bookings/${tenantId}/${bookingId}/no-show`, { method: "POST" });
  },
};

export const AnalyticsApi = {
  /** The tenant's own dashboard-side read of website-analytics data — see
   * AnalyticsController.getSummary() in the backend, gated by the existing
   * `reports:view` permission (no new permission introduced, matching this
   * project's established "don't invent a permission split nothing has
   * asked for" discipline — rbac.ts's own comment). */
  summary(tenantId: string, periodStart?: string, periodEnd?: string) {
    return apiRequest<AnalyticsSummary>(`/analytics/${tenantId}/summary`, { query: { periodStart, periodEnd } });
  },
  /** The exact absolute URL the tracking-snippet <script> tag on a
   * tenant's own website should point at — never a relative path, since
   * this loads on a completely different origin. Served by
   * AnalyticsController.trackerScript(), not a static file. */
  snippetUrl() {
    return `${API_BASE_URL}/analytics/tracker.js`;
  },
};

export const SupportTicketsApi = {
  list() {
    return apiRequest<SupportTicket[]>("/support-tickets");
  },
  create(subject: string, description: string, severity?: SupportTicketSeverity) {
    return apiRequest<SupportTicket>("/support-tickets", { method: "POST", body: { subject, description, severity } });
  },
  reopen(id: string) {
    return apiRequest<SupportTicket>(`/support-tickets/${id}/reopen`, { method: "POST" });
  },
};

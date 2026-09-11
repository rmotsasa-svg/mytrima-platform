import { apiRequest, API_BASE_URL } from "./client";
import type {
  AnalyticsSummary,
  BenchmarkComparison,
  BenchmarkKpi,
  Booking,
  BusinessProfileInput,
  BusinessSnapshot,
  CatalogItem,
  Customer,
  CustomerLifetimeValueResult,
  GrowthAuditAnswers,
  GrowthAuditQuestions,
  GrowthAuditResponse,
  ItemType,
  KpiBenchmark,
  MfaEnrollStartResult,
  NpsAggregate,
  NpsResponse,
  OnboardingStatus,
  Page,
  Rating,
  RatingAggregate,
  RatingStatus,
  RecommendationResult,
  RepeatRateResult,
  Role,
  SaleTransaction,
  SalesKpis,
  SalesTarget,
  SocialConnectionStatus,
  StaffProfile,
  SupportTicket,
  SupportTicketSeverity,
  TenantProfile,
  TokenPair,
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
  registerTenant(signupCode: string, tenantName: string, ownerEmail: string, ownerPassword: string) {
    return apiRequest<{ tenantId: string }>("/auth/tenants", { method: "POST", anonymous: true, body: { signupCode, tenantName, ownerEmail, ownerPassword } });
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
  registerStaff(email: string, password: string, role: Role) {
    return apiRequest<StaffProfile>("/auth/register", { method: "POST", body: { email, password, role } });
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
};

export const NpsApi = {
  /** GET /nps/:tenantId — same real gap, same fix, added the same day. */
  list(tenantId: string) {
    return apiRequest<NpsResponse[]>(`/nps/${tenantId}`);
  },
  aggregate(tenantId: string) {
    return apiRequest<NpsAggregate>(`/nps/${tenantId}/aggregate`);
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
    body: { customerId?: string; lineItems: { catalogItemId: string; quantity: number; unitPrice: number; discountAmount?: number }[] }
  ) {
    return apiRequest<SaleTransaction>(`/sales/${tenantId}`, { method: "POST", body });
  },
  kpis(tenantId: string, periodStart?: string, periodEnd?: string) {
    return apiRequest<SalesKpis>(`/sales/${tenantId}/kpis`, { query: { periodStart, periodEnd } });
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
};

export const CustomersApi = {
  list(tenantId: string, q?: string) {
    return apiRequest<Customer[]>(`/customers/${tenantId}`, { query: { q } });
  },
  create(body: { displayName?: string; phone?: string; email?: string }) {
    return apiRequest<Customer>("/customers", { method: "POST", body });
  },
};

export const BookingsApi = {
  list(tenantId: string) {
    return apiRequest<Booking[]>(`/bookings/${tenantId}`);
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

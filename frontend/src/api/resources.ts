import { apiRequest, API_BASE_URL } from "./client";
import type {
  Booking,
  BusinessSnapshot,
  CatalogItem,
  Customer,
  ItemType,
  MfaEnrollStartResult,
  OnboardingStatus,
  Page,
  Role,
  SaleTransaction,
  StaffProfile,
  SupportTicket,
  SupportTicketSeverity,
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

export const OnboardingApi = {
  get(tenantId: string) {
    return apiRequest<OnboardingStatus>(`/onboarding/${tenantId}`);
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
  kpis(tenantId: string) {
    return apiRequest<Record<string, unknown>>(`/sales/${tenantId}/kpis`);
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

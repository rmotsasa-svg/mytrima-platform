import { apiRequest, API_BASE_URL } from "./client";
import type { TokenPair, AdminMfaEnrollStartResult, AdminProfile, AdminTenantSummary, AdminTenantDetail } from "./types";

export interface MfaEnrollmentRequiredResponse {
  mfaEnrollmentRequired: true;
  enrollmentToken?: string;
}

export type LoginResponse = TokenPair | MfaEnrollmentRequiredResponse;

export function isMfaEnrollmentRequired(res: LoginResponse): res is MfaEnrollmentRequiredResponse {
  return (res as MfaEnrollmentRequiredResponse).mfaEnrollmentRequired === true;
}

export const AdminAuthApi = {
  login(email: string, password: string, totpCode?: string) {
    return apiRequest<LoginResponse>("/admin-auth/login", { method: "POST", anonymous: true, body: { email, password, totpCode } });
  },
  logout(refreshToken: string) {
    return apiRequest<{ loggedOut: boolean }>("/admin-auth/logout", { method: "POST", anonymous: true, body: { refreshToken } });
  },
  me() {
    return apiRequest<AdminProfile>("/admin-auth/me");
  },
  listAdmins() {
    return apiRequest<AdminProfile[]>("/admin-auth/admins");
  },
  createAdmin(email: string, password: string) {
    return apiRequest<AdminProfile>("/admin-auth/admins", { method: "POST", body: { email, password } });
  },
  /** These two calls use the short-lived MFA enrollment token, not the
   * normal stored access token — same reasoning as frontend/'s own
   * AuthApi.startMfaEnrollment()/confirmMfaEnrollment(): a brand-new
   * admin has no real access token yet at this point in the flow, so
   * apiRequest()'s own Authorization header (built from the stored
   * accessToken) bypasses this and rawBearerRequest() sets it directly. */
  async startMfaEnrollment(enrollmentToken: string) {
    return rawBearerRequest<AdminMfaEnrollStartResult>("/admin-auth/mfa/start", enrollmentToken, { method: "POST" });
  },
  async confirmMfaEnrollment(enrollmentToken: string, code: string) {
    return rawBearerRequest<{ mfaEnabled: boolean }>("/admin-auth/mfa/confirm", enrollmentToken, { method: "POST", body: { code } });
  },
};

/** Phase 2 of the admin-platform plan — real tenant management. */
export const AdminTenantApi = {
  list() {
    return apiRequest<AdminTenantSummary[]>("/admin/tenants");
  },
  detail(tenantId: string) {
    return apiRequest<AdminTenantDetail>(`/admin/tenants/${tenantId}`);
  },
  suspend(tenantId: string) {
    return apiRequest<{ success: boolean }>(`/admin/tenants/${tenantId}/suspend`, { method: "POST" });
  },
  reactivate(tenantId: string) {
    return apiRequest<{ success: boolean }>(`/admin/tenants/${tenantId}/reactivate`, { method: "POST" });
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

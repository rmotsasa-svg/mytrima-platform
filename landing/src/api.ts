/** Same env-var-with-a-localhost-default pattern as frontend/src/api/client.ts's
 * own API_BASE_URL — set VITE_API_BASE_URL at build/deploy time to point
 * this site at the real backend origin. The backend's CORS_ORIGIN must
 * list this site's own deployed origin for the signup call below to
 * actually succeed cross-origin — see main.ts's global enableCors(). */
const API_BASE_URL: string = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "http://localhost:3000";

export class SignupApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "SignupApiError";
    this.status = status;
  }
}

export interface SignupResult {
  tenantId: string;
  owner: { id: string; email: string; emailVerified: boolean };
}

/** Calls the real, now-open POST /auth/tenants — no signupCode, matching
 * this deployment's default (self-serve signup with no shared code). See
 * the backend's tenant.service.ts "DELIBERATE POLICY CHANGE" comment. */
export async function registerTenant(tenantName: string, ownerEmail: string, ownerPassword: string): Promise<SignupResult> {
  const res = await fetch(`${API_BASE_URL}/auth/tenants`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tenantName, ownerEmail, ownerPassword }),
  });
  if (!res.ok) {
    const text = await res.text();
    let message = res.statusText || `HTTP ${res.status}`;
    try {
      const body = JSON.parse(text) as { message?: string | string[] };
      message = Array.isArray(body.message) ? body.message.join("; ") : body.message ?? message;
    } catch {
      // Non-JSON error body (e.g. a plain-text 429 from RateLimitGuard) —
      // fall back to the raw text if there is any.
      if (text) message = text;
    }
    throw new SignupApiError(message, res.status);
  }
  return (await res.json()) as SignupResult;
}

/**
 * Thin fetch wrapper around the real Mytrima API — no generated client,
 * no axios. Two real, non-obvious pieces of behaviour live here:
 *
 * 1. Token storage split: the access token lives ONLY in memory (a module
 *    -level variable) — never localStorage/sessionStorage — because it's
 *    short-lived and readable by any script on the page; the refresh token
 *    goes in localStorage so a page reload doesn't force a re-login. This
 *    mirrors a standard SPA-with-refresh-rotation pattern, not something
 *    the backend enforces — the backend (auth.service.ts) only cares that
 *    a refresh token is a real, unrevoked, unexpired JWT.
 * 2. Refresh-on-401, exactly once per request: a request that comes back
 *    401 tries POST /auth/refresh with the stored refresh token, and if
 *    that succeeds, retries the ORIGINAL request once with the new access
 *    token. If the refresh itself fails, every stored token is cleared and
 *    the failure propagates — the caller (AuthContext) treats that as
 *    "session over, show the login page".
 */

const REFRESH_TOKEN_KEY = "mytrima.refreshToken";

const API_BASE_URL: string = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "http://localhost:3000";

let accessToken: string | null = null;

export function getAccessToken(): string | null {
  return accessToken;
}

export function setTokens(tokens: { accessToken: string; refreshToken: string } | null): void {
  if (tokens === null) {
    accessToken = null;
    try {
      localStorage.removeItem(REFRESH_TOKEN_KEY);
    } catch {
      // Storage can throw in a private/locked-down browser context — a
      // failed removal just means the stale token, if any, outlives this
      // tab; the in-memory accessToken is still cleared either way, which
      // is what actually gates every subsequent authenticated request.
    }
    return;
  }
  accessToken = tokens.accessToken;
  try {
    localStorage.setItem(REFRESH_TOKEN_KEY, tokens.refreshToken);
  } catch {
    // Same as above: a failed write just means this session won't survive
    // a reload, not a broken login — accessToken is already set in memory.
  }
}

function getStoredRefreshToken(): string | null {
  try {
    return localStorage.getItem(REFRESH_TOKEN_KEY);
  } catch {
    return null;
  }
}

export class ApiError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(status: number, message: string, body?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

async function parseErrorMessage(res: Response): Promise<{ message: string; body: unknown }> {
  const text = await res.text();
  if (!text) return { message: res.statusText || `HTTP ${res.status}`, body: undefined };
  try {
    const body = JSON.parse(text) as { message?: string | string[] };
    const message = Array.isArray(body.message) ? body.message.join("; ") : body.message ?? res.statusText;
    return { message: message || `HTTP ${res.status}`, body };
  } catch {
    return { message: text, body: text };
  }
}

/** Calls POST /auth/refresh directly (bypassing request(), which would
 * recurse into this same refresh logic) using whatever refresh token is
 * currently stored. Throws ApiError on any failure and clears stored
 * tokens — a refresh token can fail for real reasons (revoked at logout,
 * rotated by a previous refresh already, or simply expired), and none of
 * them are recoverable except by a fresh login. */
async function refreshAccessToken(): Promise<void> {
  const refreshToken = getStoredRefreshToken();
  if (!refreshToken) {
    throw new ApiError(401, "No refresh token available");
  }
  const res = await fetch(`${API_BASE_URL}/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken }),
  });
  if (!res.ok) {
    setTokens(null);
    const { message, body } = await parseErrorMessage(res);
    throw new ApiError(res.status, message, body);
  }
  const tokens = (await res.json()) as { accessToken: string; refreshToken: string };
  setTokens(tokens);
}

export interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  query?: Record<string, string | number | undefined>;
  /** Skip the Authorization header entirely — for the few genuinely
   * unauthenticated endpoints (booking request, rating submit, nps submit,
   * tenant registration, login itself). */
  anonymous?: boolean;
}

function buildUrl(path: string, query?: RequestOptions["query"]): string {
  const url = new URL(path, API_BASE_URL);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

async function rawRequest<T>(path: string, options: RequestOptions): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (!options.anonymous && accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }
  const res = await fetch(buildUrl(path, options.query), {
    method: options.method ?? "GET",
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  if (!res.ok) {
    const { message, body } = await parseErrorMessage(res);
    throw new ApiError(res.status, message, body);
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

/** One in-flight refresh at a time — if three requests all 401 at once
 * (e.g. the dashboard fires several list calls in parallel right after an
 * access token expires), they share one refresh attempt instead of racing
 * three separate POST /auth/refresh calls, each of which would ROTATE the
 * refresh token (see auth.service.ts's refresh() — it's single-use) and
 * invalidate the other two in flight. */
let refreshInFlight: Promise<void> | null = null;

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  try {
    return await rawRequest<T>(path, options);
  } catch (err) {
    if (err instanceof ApiError && err.status === 401 && !options.anonymous) {
      if (!refreshInFlight) {
        refreshInFlight = refreshAccessToken().finally(() => {
          refreshInFlight = null;
        });
      }
      await refreshInFlight;
      return rawRequest<T>(path, options);
    }
    throw err;
  }
}

/** Real multipart image upload — apiRequest() above always sends
 * `Content-Type: application/json` and JSON.stringify()s its body, which
 * would silently corrupt a real binary upload, so this is a genuinely
 * separate path, not a variant of apiRequest(). Same single-flight
 * refresh-on-401 behavior via the shared refreshInFlight lock above (a
 * second concurrent upload racing its own refresh would rotate the
 * refresh token out from under the first, the same real bug apiRequest()
 * itself exists to avoid). No `Content-Type` header is set here on
 * purpose — letting the browser set its own `multipart/form-data;
 * boundary=...` is required for the server to parse the body at all. */
export async function uploadImage<T>(path: string, file: File): Promise<T> {
  const form = new FormData();
  form.append("image", file);

  async function attempt(): Promise<T> {
    const res = await fetch(`${API_BASE_URL}${path}`, {
      method: "POST",
      headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
      body: form,
    });
    if (!res.ok) {
      const { message, body } = await parseErrorMessage(res);
      throw new ApiError(res.status, message, body);
    }
    const text = await res.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }

  try {
    return await attempt();
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      if (!refreshInFlight) {
        refreshInFlight = refreshAccessToken().finally(() => {
          refreshInFlight = null;
        });
      }
      await refreshInFlight;
      return attempt();
    }
    throw err;
  }
}

/** Every uploaded-image URL from the backend (CatalogItem.imageUrl,
 * Deal.adImageUrl) is a relative path like "/uploads/catalog/<tenantId>/
 * <file>.png" — it's served by the API origin, not this SPA's own origin,
 * so an <img src> needs API_BASE_URL prefixed on it. Returns undefined
 * unchanged so a caller can write `src={resolveUploadUrl(item.imageUrl)}`
 * and let a real "no photo yet" placeholder handle the rest. */
export function resolveUploadUrl(path: string | undefined): string | undefined {
  return path ? `${API_BASE_URL}${path}` : undefined;
}

export { API_BASE_URL };

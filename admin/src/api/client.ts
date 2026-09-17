/**
 * Thin fetch wrapper around the real Mytrima admin API — a deliberate,
 * simplified sibling of frontend/src/api/client.ts, not a shared package
 * (admin/ and frontend/ are genuinely separate builds). Keeps the two
 * real, non-obvious pieces of behaviour that file's own top comment
 * documents: access token in memory only (never persisted — short-lived
 * and readable by any script on the page), refresh token in localStorage
 * under ITS OWN key (mytrima-admin.refreshToken, never the tenant SPA's
 * own mytrima.refreshToken — the two must never collide even if someone
 * somehow opened both apps on the same origin), and refresh-on-401 with a
 * single in-flight lock so parallel requests share one refresh attempt.
 */

const REFRESH_TOKEN_KEY = "mytrima-admin.refreshToken";

type SessionExpiredListener = () => void;
const sessionExpiredListeners = new Set<SessionExpiredListener>();

export function onSessionExpired(listener: SessionExpiredListener): () => void {
  sessionExpiredListeners.add(listener);
  return () => sessionExpiredListeners.delete(listener);
}

function notifySessionExpired(): void {
  for (const listener of sessionExpiredListeners) listener();
}

const API_BASE_URL: string = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "http://localhost:3000";

let accessToken: string | null = null;

export function setTokens(tokens: { accessToken: string; refreshToken: string } | null): void {
  if (tokens === null) {
    accessToken = null;
    try {
      localStorage.removeItem(REFRESH_TOKEN_KEY);
    } catch {
      // Same as frontend/'s own client.ts: a failed removal just means a
      // stale token outlives this tab — accessToken is cleared regardless.
    }
    return;
  }
  accessToken = tokens.accessToken;
  try {
    localStorage.setItem(REFRESH_TOKEN_KEY, tokens.refreshToken);
  } catch {
    // A failed write just means this session won't survive a reload.
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

/** Calls POST /admin-auth/refresh directly — same "only clear tokens when
 * the stored token is still the exact one that just failed" real-bug fix
 * as frontend/'s own refreshAccessToken(), for the same multi-tab race
 * reason. */
async function refreshAccessToken(): Promise<void> {
  const refreshToken = getStoredRefreshToken();
  if (!refreshToken) {
    notifySessionExpired();
    throw new ApiError(401, "No refresh token available");
  }
  const res = await fetch(`${API_BASE_URL}/admin-auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken }),
  });
  if (!res.ok) {
    if (getStoredRefreshToken() === refreshToken) {
      setTokens(null);
      notifySessionExpired();
    }
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
   * unauthenticated/bootstrap-keyed endpoints (login itself, and the
   * ADMIN_API_KEY-gated bootstrap register call). */
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

export { API_BASE_URL };

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { ApiError, setTokens } from "../api/client";
import { AuthApi, StaffApi, isMfaEnrollmentRequired } from "../api/resources";
import type { StaffProfile } from "../api/types";

type Session =
  | { status: "loading" }
  | { status: "loggedOut" }
  | { status: "loggedIn"; profile: StaffProfile }
  /** The real first-login-ever-for-this-owner path (see auth.service.ts's
   * "REAL BUG found 2026-09-10" comment this whole project's README
   * documents) — a brand-new owner has no MFA secret yet, so login()
   * returns an enrollmentToken instead of tokens, and the SPA has to walk
   * them through enroll -> confirm -> log in again before anything else. */
  | { status: "mfaEnrollmentRequired"; enrollmentToken: string };

interface AuthContextValue {
  session: Session;
  login(tenantId: string, email: string, password: string, totpCode?: string): Promise<"loggedIn" | "mfaEnrollmentRequired">;
  logout(): Promise<void>;
  refreshProfile(): Promise<void>;
  /** Returns from the mfaEnrollmentRequired step back to the login form —
   * used once MFA is confirmed (the owner must sign in again with a real
   * code; confirmMfaEnrollment() itself issues no tokens) or if they
   * abandon enrollment. */
  backToLogin(): void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const REFRESH_TOKEN_KEY = "mytrima.refreshToken";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session>({ status: "loading" });

  const loadProfile = useCallback(async () => {
    const profile = await StaffApi.me();
    setSession({ status: "loggedIn", profile });
  }, []);

  // On first mount: if a refresh token survived from a previous visit,
  // StaffApi.me() deliberately has no access token yet in memory, so it
  // gets a real 401 from the backend — apiRequest's own refresh-on-401
  // logic (client.ts) then exchanges the stored refresh token for a fresh
  // pair and retries. If there's no stored refresh token at all, that
  // exchange fails immediately with no network call, and this session is
  // correctly treated as logged out.
  useEffect(() => {
    let hasStoredRefreshToken = false;
    try {
      hasStoredRefreshToken = localStorage.getItem(REFRESH_TOKEN_KEY) !== null;
    } catch {
      hasStoredRefreshToken = false;
    }
    if (!hasStoredRefreshToken) {
      setSession({ status: "loggedOut" });
      return;
    }
    loadProfile().catch(() => {
      setTokens(null);
      setSession({ status: "loggedOut" });
    });
  }, [loadProfile]);

  const login = useCallback(
    async (tenantId: string, email: string, password: string, totpCode?: string): Promise<"loggedIn" | "mfaEnrollmentRequired"> => {
      const result = await AuthApi.login(tenantId, email, password, totpCode);
      if (isMfaEnrollmentRequired(result)) {
        setSession({ status: "mfaEnrollmentRequired", enrollmentToken: result.enrollmentToken });
        return "mfaEnrollmentRequired";
      }
      setTokens(result);
      await loadProfile();
      return "loggedIn";
    },
    [loadProfile]
  );

  const logout = useCallback(async () => {
    let refreshToken: string | null = null;
    try {
      refreshToken = localStorage.getItem(REFRESH_TOKEN_KEY);
    } catch {
      refreshToken = null;
    }
    setTokens(null);
    setSession({ status: "loggedOut" });
    if (refreshToken) {
      // Best-effort — revokes the refresh token server-side (see
      // auth.service.ts's logout()) so it can't be replayed later, but a
      // network failure here shouldn't block the user leaving the page:
      // the local session is already cleared above regardless.
      try {
        await AuthApi.logout(refreshToken);
      } catch {
        /* already logged out locally either way */
      }
    }
  }, []);

  const backToLogin = useCallback(() => setSession({ status: "loggedOut" }), []);

  const value = useMemo<AuthContextValue>(
    () => ({ session, login, logout, refreshProfile: loadProfile, backToLogin }),
    [session, login, logout, loadProfile, backToLogin]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth() must be used inside <AuthProvider>");
  return ctx;
}

export { ApiError };

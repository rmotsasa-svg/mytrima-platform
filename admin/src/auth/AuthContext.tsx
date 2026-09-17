import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { ApiError, onSessionExpired, setTokens } from "../api/client";
import { AdminAuthApi, isMfaEnrollmentRequired } from "../api/resources";
import type { AdminProfile } from "../api/types";

type Session =
  | { status: "loading" }
  | { status: "loggedOut" }
  | { status: "loggedIn"; profile: AdminProfile }
  /** Every admin account must enroll MFA before its first real login
   * (unconditional — see admin-auth.service.ts's own top comment) — same
   * real gate frontend/'s own AuthContext.tsx documents for a fresh
   * tenant owner. */
  | { status: "mfaEnrollmentRequired"; enrollmentToken: string };

interface AuthContextValue {
  session: Session;
  login(email: string, password: string, totpCode?: string): Promise<"loggedIn" | "mfaEnrollmentRequired">;
  logout(): Promise<void>;
  backToLogin(): void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const REFRESH_TOKEN_KEY = "mytrima-admin.refreshToken";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session>({ status: "loading" });

  const loadProfile = useCallback(async () => {
    const profile = await AdminAuthApi.me();
    setSession({ status: "loggedIn", profile });
  }, []);

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

  useEffect(() => onSessionExpired(() => setSession({ status: "loggedOut" })), []);

  const login = useCallback(
    async (email: string, password: string, totpCode?: string): Promise<"loggedIn" | "mfaEnrollmentRequired"> => {
      const result = await AdminAuthApi.login(email, password, totpCode);
      if (isMfaEnrollmentRequired(result)) {
        setSession({ status: "mfaEnrollmentRequired", enrollmentToken: result.enrollmentToken ?? "" });
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
      try {
        await AdminAuthApi.logout(refreshToken);
      } catch {
        /* already logged out locally either way */
      }
    }
  }, []);

  const backToLogin = useCallback(() => setSession({ status: "loggedOut" }), []);

  const value = useMemo<AuthContextValue>(() => ({ session, login, logout, backToLogin }), [session, login, logout, backToLogin]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth() must be used inside <AuthProvider>");
  return ctx;
}

export { ApiError };

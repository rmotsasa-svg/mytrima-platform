import { useState, type FormEvent } from "react";
import { useAuth } from "./AuthContext";
import { ApiError } from "../api/client";
import { Banner, Button } from "../components/ui";
import "./auth-pages.css";

/** Simplified sibling of frontend/src/auth/LoginPage.tsx — no Tenant ID
 * field (an admin isn't scoped to any tenant) and no email-verification
 * flow (admin accounts are created directly, either by the ADMIN_API_KEY
 * bootstrap or by another already-logged-in admin — never self-serve, so
 * there's no unverified inbox to prove). */
export function LoginPage() {
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      // "mfaEnrollmentRequired" needs no extra handling here — AuthGate
      // (App.tsx) renders <MfaEnrollPage> directly off session.status.
      await login(email.trim(), password, totpCode.trim() || undefined);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the Mytrima admin API.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-brand">
          <img src="/brand/lockup-horizontal-teal.png" alt="Mytrima" />
        </div>
        <p className="auth-subtitle">Platform administration — sign in with your admin account.</p>
        {error && <Banner kind="error">{error}</Banner>}
        <form onSubmit={handleSubmit}>
          <div className="field">
            <label htmlFor="email">Email</label>
            <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="username" />
          </div>
          <div className="field">
            <label htmlFor="password">Password</label>
            <input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" />
          </div>
          <div className="field">
            <label htmlFor="totpCode">Authenticator code</label>
            <input id="totpCode" value={totpCode} onChange={(e) => setTotpCode(e.target.value)} placeholder="123456" inputMode="numeric" />
          </div>
          <Button type="submit" variant="primary" disabled={submitting} style={{ width: "100%", justifyContent: "center", marginTop: "0.4rem" }}>
            {submitting ? "Signing in…" : "Sign in"}
          </Button>
        </form>
      </div>
    </div>
  );
}

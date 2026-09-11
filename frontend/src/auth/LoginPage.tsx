import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "./AuthContext";
import { ApiError } from "../api/client";
import { Banner, Button } from "../components/ui";
import "./auth-pages.css";

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [tenantId, setTenantId] = useState("");
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
      const outcome = await login(tenantId.trim(), email.trim(), password, totpCode.trim() || undefined);
      if (outcome === "loggedIn") navigate("/", { replace: true });
      // "mfaEnrollmentRequired" needs no navigation here — AuthGate (App.tsx)
      // renders <MfaEnrollPage> directly off session.status, without a route
      // change, since there's no separate URL for this one-time step.
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the Mytrima API.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-brand">
          <span className="shell-brand-mark" style={{ background: "var(--color-gold)" }}>
            M
          </span>
          <h1>Mytrima</h1>
        </div>
        <p className="auth-subtitle">Sign in to your tenant's workspace.</p>
        {error && <Banner kind="error">{error}</Banner>}
        <form onSubmit={handleSubmit}>
          <div className="field">
            <label htmlFor="tenantId">Tenant ID</label>
            <input id="tenantId" value={tenantId} onChange={(e) => setTenantId(e.target.value)} required autoComplete="off" />
          </div>
          <div className="field">
            <label htmlFor="email">Email</label>
            <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="username" />
          </div>
          <div className="field">
            <label htmlFor="password">Password</label>
            <input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" />
          </div>
          <div className="field">
            <label htmlFor="totpCode">Authenticator code (only if MFA is already enabled)</label>
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

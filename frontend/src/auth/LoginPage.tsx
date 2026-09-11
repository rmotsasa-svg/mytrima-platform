import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "./AuthContext";
import { ApiError } from "../api/client";
import { AuthApi } from "../api/resources";
import { Banner, Button } from "../components/ui";
import "./auth-pages.css";

/** ApiError.body is the real JSON DomainErrorFilter sends —
 * `{statusCode, error, message}` — but typed loosely elsewhere in this app
 * since most callers only ever read `.message`. This page is the one place
 * that needs to distinguish EmailNotVerifiedError specifically (to offer a
 * resend), so it narrows locally rather than widening ApiError's own type
 * for every other caller. */
function isEmailNotVerified(err: unknown): boolean {
  return err instanceof ApiError && (err.body as { error?: string } | undefined)?.error === "EmailNotVerifiedError";
}

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [tenantId, setTenantId] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [needsVerification, setNeedsVerification] = useState(false);
  const [resendStatus, setResendStatus] = useState<"idle" | "sending" | "sent">("idle");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setNeedsVerification(false);
    setResendStatus("idle");
    setSubmitting(true);
    try {
      const outcome = await login(tenantId.trim(), email.trim(), password, totpCode.trim() || undefined);
      if (outcome === "loggedIn") navigate("/", { replace: true });
      // "mfaEnrollmentRequired" needs no navigation here — AuthGate (App.tsx)
      // renders <MfaEnrollPage> directly off session.status, without a route
      // change, since there's no separate URL for this one-time step.
    } catch (err) {
      if (isEmailNotVerified(err)) {
        setNeedsVerification(true);
      }
      setError(err instanceof ApiError ? err.message : "Could not reach the Mytrima API.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleResend() {
    setResendStatus("sending");
    try {
      await AuthApi.resendVerificationEmail(tenantId.trim(), email.trim());
    } catch {
      // Deliberately ignored — resendVerificationEmail() already never
      // reveals whether the account exists, so there's nothing more
      // specific to tell the caller even on a genuine network failure here.
    } finally {
      setResendStatus("sent");
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-brand">
          <img src="/brand/lockup-horizontal-light.svg" alt="Mytrima — Built for how you grow" />
        </div>
        <p className="auth-subtitle">Sign in to your tenant's workspace.</p>
        {error && <Banner kind="error">{error}</Banner>}
        {needsVerification && (
          <Banner kind="info">
            {resendStatus === "sent" ? (
              "If that account exists and needs verifying, we've sent a new link — check your inbox."
            ) : (
              <>
                Didn't get the email, or has it expired?{" "}
                <button
                  type="button"
                  onClick={() => void handleResend()}
                  disabled={resendStatus === "sending"}
                  style={{ background: "none", border: "none", padding: 0, font: "inherit", color: "inherit", textDecoration: "underline", cursor: "pointer" }}
                >
                  {resendStatus === "sending" ? "Sending…" : "Send a new link"}
                </button>
              </>
            )}
          </Banner>
        )}
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

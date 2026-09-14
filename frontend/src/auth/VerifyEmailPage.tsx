import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AuthApi } from "../api/resources";
import { ApiError } from "../api/client";
import { Banner } from "../components/ui";
import "./auth-pages.css";

type Status = "checking" | "verified" | "failed";

/**
 * The landing spot for the real link a self-serve owner is emailed at
 * signup — see the backend's tenant.service.ts (buildVerificationUrl())
 * and auth.controller.ts (verifyEmail()). Reached WITHOUT a session — this
 * route is checked in App.tsx before AuthGate's normal logged-in/logged-out
 * branch, exactly like LoginPage/MfaEnrollPage's own pre-session states,
 * since a brand-new owner clicking an emailed link has no session yet by
 * definition.
 *
 * Idempotent by design (see AuthService.verifyEmailAddress()'s own
 * comment) — a stale browser tab re-hitting this page, or an email
 * security scanner pre-fetching the link, both succeed the same way a
 * fresh click does.
 */
export function VerifyEmailPage() {
  const [status, setStatus] = useState<Status>("checking");
  const [error, setError] = useState<string | null>(null);
  // REAL BUG found live-testing self-serve signup end to end (2026-09-14):
  // LoginPage.tsx's "Tenant ID" field is required to sign in, but nothing
  // in this whole signup -> verify -> sign in flow ever told a brand-new
  // owner what theirs was — HomePage.tsx's own success message only ever
  // echoed back the email address. The backend has always returned it
  // here too (see AuthApi.verifyEmail's own updated comment); this page
  // just never read it. Shown once, on this page, since it's the one step
  // every self-serve owner is guaranteed to actually reach (unlike the
  // landing page's success message, which a slow inbox check can lose).
  const [tenantId, setTenantId] = useState<string | null>(null);

  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get("token");
    if (!token) {
      setStatus("failed");
      setError("This link is missing its verification token.");
      return;
    }
    AuthApi.verifyEmail(token)
      .then((result) => {
        setTenantId(result.tenantId);
        setStatus("verified");
      })
      .catch((err) => {
        setStatus("failed");
        setError(err instanceof ApiError ? err.message : "Could not verify this email address.");
      });
  }, []);

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-brand">
          <img src="/brand/icon-mark-teal.png" alt="" width={34} height={34} style={{ borderRadius: 8 }} />
          <h1>Verify your email</h1>
        </div>

        {status === "checking" && <p className="auth-subtitle">Checking your link…</p>}

        {status === "verified" && (
          <>
            <Banner kind="info">Your email is verified. You can now sign in.</Banner>
            {tenantId && (
              <>
                <p style={{ fontSize: "0.85rem", margin: "0.8rem 0 0.2rem" }}>
                  You'll need your Tenant ID to sign in — save it now:
                </p>
                <div className="auth-secret">{tenantId}</div>
              </>
            )}
            <Link to="/" className="btn btn-primary" style={{ width: "100%", justifyContent: "center", marginTop: "0.8rem" }}>
              Go to sign in
            </Link>
          </>
        )}

        {status === "failed" && (
          <>
            <Banner kind="error">{error}</Banner>
            <p className="auth-subtitle" style={{ marginTop: "0.6rem" }}>
              This link may have expired — verification links last 24 hours. Try signing in below; you'll be able to request a new
              one from there.
            </p>
            <Link to="/" className="btn btn-secondary" style={{ width: "100%", justifyContent: "center", marginTop: "0.4rem" }}>
              Go to sign in
            </Link>
          </>
        )}
      </div>
    </div>
  );
}

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

  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get("token");
    if (!token) {
      setStatus("failed");
      setError("This link is missing its verification token.");
      return;
    }
    AuthApi.verifyEmail(token)
      .then(() => setStatus("verified"))
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
            <Link to="/" className="btn btn-primary" style={{ width: "100%", justifyContent: "center", marginTop: "0.4rem" }}>
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

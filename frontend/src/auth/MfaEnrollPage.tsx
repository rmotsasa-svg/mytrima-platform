import { useEffect, useState } from "react";
import { AuthApi } from "../api/resources";
import { Banner, Button } from "../components/ui";
import "./auth-pages.css";

/**
 * Rendered directly off session.status === "mfaEnrollmentRequired" (see
 * App.tsx) — a brand-new owner's very first login lands here instead of
 * the dashboard (see auth.service.ts's own "REAL BUG found 2026-09-10"
 * comment: a fresh owner has no MFA secret yet, so backend login() returns
 * an enrollmentToken instead of a token pair). Walks: start enrollment
 * (get a real TOTP secret) -> the owner adds it to their authenticator app
 * -> confirm with a real 6-digit code -> the backend turns mfaEnabled on
 * -> the owner logs in again, this time WITH that code, and gets real
 * tokens. confirmMfaEnrollment() itself returns no tokens (see
 * staff.controller.ts's sibling, auth.controller.ts), so a second real
 * login is the correct, not a shortcut-around, next step.
 */
export function MfaEnrollPage({ enrollmentToken, onDone }: { enrollmentToken: string; onDone: () => void }) {
  const [secret, setSecret] = useState<string | null>(null);
  const [otpauthUrl, setOtpauthUrl] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    AuthApi.startMfaEnrollment(enrollmentToken)
      .then((res) => {
        if (cancelled) return;
        setSecret(res.secret);
        setOtpauthUrl(res.otpauthUrl);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Could not start MFA enrollment."));
    return () => {
      cancelled = true;
    };
  }, [enrollmentToken]);

  async function handleConfirm() {
    setError(null);
    setBusy(true);
    try {
      await AuthApi.confirmMfaEnrollment(enrollmentToken, code.trim());
      setConfirmed(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "That code didn't verify — check the time on your device and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-brand">
          <img src="/favicon.svg" alt="" width={34} height={34} style={{ borderRadius: 8 }} />
          <h1>Set up your authenticator</h1>
        </div>
        {confirmed ? (
          <>
            <p className="auth-subtitle">
              Two-factor authentication is on for this account. Sign in again with your password and a fresh 6-digit code.
            </p>
            <Button variant="primary" style={{ width: "100%", justifyContent: "center" }} onClick={onDone}>
              Back to sign in
            </Button>
          </>
        ) : (
          <>
            <p className="auth-subtitle">
              Mytrima requires an owner's first login to enroll an authenticator app (Google Authenticator, Authy, 1Password, etc.).
            </p>
            {error && <Banner kind="error">{error}</Banner>}
            {secret ? (
              <>
                <p style={{ fontSize: "0.85rem", margin: "0 0 0.2rem" }}>Add this key manually, or use the otpauth:// URL below with an app that accepts it:</p>
                <div className="auth-secret">{secret}</div>
                <div className="auth-secret" style={{ fontSize: "0.72rem" }}>
                  {otpauthUrl}
                </div>
                <div className="field" style={{ marginBottom: "0.9rem" }}>
                  <label htmlFor="mfaCode">6-digit code from your app</label>
                  <input id="mfaCode" value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" placeholder="123456" />
                </div>
                <Button variant="primary" disabled={busy || code.trim().length === 0} style={{ width: "100%", justifyContent: "center" }} onClick={() => void handleConfirm()}>
                  {busy ? "Confirming…" : "Confirm and enable MFA"}
                </Button>
              </>
            ) : (
              !error && <p>Starting enrollment…</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

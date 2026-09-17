import { useEffect, useState } from "react";
import { AdminAuthApi } from "../api/resources";
import { Banner, Button } from "../components/ui";
import "./auth-pages.css";

/** Near-identical sibling of frontend/src/auth/MfaEnrollPage.tsx — see
 * that file's own top comment for the full flow. Every admin account
 * hits this on its first login, unconditionally (not owner-only, the
 * tenant SPA's own rule). */
export function MfaEnrollPage({ enrollmentToken, onDone }: { enrollmentToken: string; onDone: () => void }) {
  const [secret, setSecret] = useState<string | null>(null);
  const [otpauthUrl, setOtpauthUrl] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    AdminAuthApi.startMfaEnrollment(enrollmentToken)
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
      await AdminAuthApi.confirmMfaEnrollment(enrollmentToken, code.trim());
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
          <img src="/brand/icon-mark-teal.png" alt="" width={34} height={34} style={{ borderRadius: 8 }} />
          <h1>Set up your authenticator</h1>
        </div>
        {confirmed ? (
          <>
            <p className="auth-subtitle">Two-factor authentication is on for this admin account. Sign in again with your password and a fresh 6-digit code.</p>
            <Button variant="primary" style={{ width: "100%", justifyContent: "center" }} onClick={onDone}>
              Back to sign in
            </Button>
          </>
        ) : (
          <>
            <p className="auth-subtitle">Every Mytrima admin account requires an authenticator app (Google Authenticator, Authy, 1Password, etc.) before it can sign in.</p>
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

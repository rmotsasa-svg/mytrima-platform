import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { OnboardingApi, SettingsApi } from "../api/resources";
import type { SocialConnectionStatus } from "../api/types";
import { useAuth } from "../auth/AuthContext";
import { ApiError } from "../api/client";
import { Banner, Button, Card, PageHeader, Pill } from "../components/ui";

/** All three settings here are gated `tenant:manage_settings`/`social:manage`
 * on the backend — owner-only (see rbac.ts) — so this whole page is
 * owner-gated the same way StaffPage's teammate-management section is,
 * rather than letting a non-owner submit a form that would just 403. */
export function SettingsPage() {
  const { session } = useAuth();
  const isOwner = session.status === "loggedIn" && session.profile.role === "owner";
  const tenantId = session.status === "loggedIn" ? session.profile.tenantId : "";

  return (
    <div>
      <PageHeader title="Settings" subtitle="Tenant-level configuration — WhatsApp notifications, PayFast payouts, and your Facebook Page connection." />
      {!isOwner ? (
        <Banner kind="info">Only an owner can view or change these settings.</Banner>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "1.1rem" }}>
          {/* Phase 8 (GrowthOS plan) — "Getting started" left the
              permanent sidebar in Phase 1, replaced by the automatic
              first-run wizard. The real computed checklist (OnboardingPage
              .tsx/onboarding.service.ts) is untouched and still fully
              reachable, just from here now, for a tenant that skipped the
              wizard or wants to revisit a step later. */}
          <Card title="Setup checklist">
            <p style={{ marginTop: 0, marginBottom: "0.7rem", color: "var(--color-ink-muted)", fontSize: "0.88rem" }}>
              The full getting-started checklist — WhatsApp, PayFast, your first customer, and more.
            </p>
            <Link to="/onboarding" className="btn btn-secondary">
              Open setup checklist
            </Link>
          </Card>
          <NotificationPhoneCard />
          <PayfastMerchantIdCard tenantId={tenantId} />
          <SocialConnectionCard tenantId={tenantId} />
        </div>
      )}
    </div>
  );
}

/** There's no GET endpoint anywhere in this API that returns a tenant's own
 * notificationPhoneE164/payfastMerchantId value (see backend README/
 * tenant.service.ts — PATCH/POST-only, write side only) — the onboarding
 * checklist's hasNotificationPhone/hasPayfastMerchantId booleans are the
 * only real signal this SPA has for "is one already set", so that's what
 * these two cards show, honestly labeled as a status rather than the
 * actual stored value this API simply doesn't expose. */
function useOnboardingSignal(tenantId: string) {
  const [hasNotificationPhone, setHasNotificationPhone] = useState<boolean | null>(null);
  const [hasPayfastMerchantId, setHasPayfastMerchantId] = useState<boolean | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    if (!tenantId) return;
    OnboardingApi.get(tenantId).then((status) => {
      setHasNotificationPhone(status.steps.find((s) => s.key === "notification_phone")?.completed ?? null);
      setHasPayfastMerchantId(status.steps.find((s) => s.key === "payfast_merchant_id")?.completed ?? null);
    });
  }, [tenantId, reloadToken]);

  return { hasNotificationPhone, hasPayfastMerchantId, refresh: () => setReloadToken((t) => t + 1) };
}

/** Exported (Phase 8, GrowthOS plan) so OnboardingWizardPage.tsx's own
 * "Connect your data" step can reuse these exact three real cards instead
 * of a second copy of the same forms/API calls. */
export function NotificationPhoneCard() {
  const { session } = useAuth();
  const tenantId = session.status === "loggedIn" ? session.profile.tenantId : "";
  const { hasNotificationPhone, refresh } = useOnboardingSignal(tenantId);
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    setError(null);
    setMessage(null);
    setSubmitting(true);
    try {
      await SettingsApi.setNotificationPhone(phone.trim());
      setMessage("Saved.");
      setPhone("");
      refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save this number.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card
      title="WhatsApp notifications"
      actions={hasNotificationPhone !== null && <Pill tone={hasNotificationPhone ? "positive" : "neutral"}>{hasNotificationPhone ? "Set" : "Not set"}</Pill>}
    >
      <p style={{ marginTop: 0, color: "var(--color-ink-muted)", fontSize: "0.88rem" }}>Where booking and system notifications get sent.</p>
      {message && <Banner kind="info">{message}</Banner>}
      {error && <Banner kind="error">{error}</Banner>}
      <div className="form-grid">
        <div className="field">
          <label htmlFor="notif-phone">Phone number (E.164, e.g. +26658123456)</label>
          <input id="notif-phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+26658123456" />
        </div>
        <Button variant="primary" disabled={submitting || !phone.trim()} onClick={() => void handleSubmit()}>
          {submitting ? "Saving…" : "Save"}
        </Button>
      </div>
    </Card>
  );
}

export function PayfastMerchantIdCard({ tenantId }: { tenantId: string }) {
  const { hasPayfastMerchantId, refresh } = useOnboardingSignal(tenantId);
  const [merchantId, setMerchantId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    setError(null);
    setMessage(null);
    setSubmitting(true);
    try {
      await SettingsApi.setPayfastMerchantId(tenantId, merchantId.trim());
      setMessage("Saved.");
      setMerchantId("");
      refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save this merchant id.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card
      title="PayFast payouts"
      actions={hasPayfastMerchantId !== null && <Pill tone={hasPayfastMerchantId ? "positive" : "neutral"}>{hasPayfastMerchantId ? "Set" : "Not set"}</Pill>}
    >
      <p style={{ marginTop: 0, color: "var(--color-ink-muted)", fontSize: "0.88rem" }}>
        Your own PayFast merchant id — checkouts split each payment between Mytrima's account and this one directly.
      </p>
      {message && <Banner kind="info">{message}</Banner>}
      {error && <Banner kind="error">{error}</Banner>}
      <div className="form-grid">
        <div className="field">
          <label htmlFor="payfast-id">PayFast merchant id</label>
          <input id="payfast-id" value={merchantId} onChange={(e) => setMerchantId(e.target.value)} />
        </div>
        <Button variant="primary" disabled={submitting || !merchantId.trim()} onClick={() => void handleSubmit()}>
          {submitting ? "Saving…" : "Save"}
        </Button>
      </div>
    </Card>
  );
}

export function SocialConnectionCard({ tenantId }: { tenantId: string }) {
  const [connection, setConnection] = useState<SocialConnectionStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!tenantId) return;
    setLoading(true);
    SettingsApi.getSocialConnection(tenantId)
      .then(setConnection)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load your Facebook connection."))
      .finally(() => setLoading(false));
  }, [tenantId]);

  return (
    <Card title="Facebook Page" actions={connection && <Pill tone={connection.connected ? "positive" : "neutral"}>{connection.connected ? "Connected" : "Not connected"}</Pill>}>
      {error && <Banner kind="error">{error}</Banner>}
      {loading && <p style={{ color: "var(--color-ink-muted)" }}>Loading…</p>}
      {connection && (
        <>
          {connection.connected ? (
            <p style={{ margin: 0 }}>
              Connected to <strong>{connection.pageName}</strong>
              {connection.instagramConnected && " — Instagram linked too"}.
            </p>
          ) : (
            <p style={{ marginTop: 0, color: "var(--color-ink-muted)", fontSize: "0.88rem" }}>
              Connect a Facebook Page to post updates and pull engagement metrics into your Business Snapshot.
            </p>
          )}
          {/* A styled link, not <Button> wrapping <a> — this navigates the
              browser to a real backend redirect (GET /social/:tenantId/connect
              -> Facebook's OAuth dialog), so it needs to BE the anchor, not
              nest one inside a <button>. */}
          <a href={SettingsApi.connectFacebookUrl(tenantId)} className={`btn btn-${connection.connected ? "secondary" : "primary"}`} style={{ marginTop: "0.6rem" }}>
            {connection.connected ? "Reconnect a Facebook Page" : "Connect a Facebook Page"}
          </a>
        </>
      )}
    </Card>
  );
}

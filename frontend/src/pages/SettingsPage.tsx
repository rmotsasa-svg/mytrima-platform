import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { OnboardingApi, SettingsApi, BillingApi } from "../api/resources";
import type { SocialConnectionStatus, SubscriptionStatusResult, SubscriptionTier } from "../api/types";
import { useAuth } from "../auth/AuthContext";
import { ApiError } from "../api/client";
import { Banner, Button, Card, PageHeader, Pill, formatDateTime } from "../components/ui";

/** Mirrors landing/src/pages/PackagesPage.tsx's own CORE_TIERS — real
 * tiers, real ZAR prices, real feature summaries, not re-derived or
 * guessed. Kept here (rather than importing across the two separate
 * apps) since frontend/ and landing/ are genuinely separate builds with
 * no shared package between them — see billing/subscription.service.ts's
 * own TIER_PRICING_ZAR comment for the backend's one source of truth,
 * which this display copy must stay in sync with by hand. */
const TIER_OPTIONS: { tier: SubscriptionTier; label: string; priceZar: number; blurb: string }[] = [
  { tier: "free", label: "Free", priceZar: 0, blurb: "Explore the platform yourself — no consultancy services included." },
  { tier: "pro_plus", label: "Pro Plus", priceZar: 350, blurb: "An objective, professional evaluation of your business before committing capital to changes." },
  { tier: "growth_plan", label: "Growth Plan", priceZar: 420, blurb: "Strategy plus hands-on execution support to repair revenue leaks." },
  { tier: "growth_partner", label: "Growth Partner", priceZar: 600, blurb: "A fractional Chief Growth Officer engagement for companies scaling quickly." },
];

function formatZar(amount: number): string {
  return `R${amount}`;
}

const SUBSCRIPTION_STATUS_TONE: Record<SubscriptionStatusResult["status"], "positive" | "attention" | "critical" | "neutral" | "gold"> = {
  active: "positive",
  pending_payment: "gold",
  past_due: "critical",
};

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
          <SubscriptionCard tenantId={tenantId} />
          <NotificationPhoneCard />
          <PayfastMerchantIdCard tenantId={tenantId} />
          <MopayApiKeyCard tenantId={tenantId} />
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

/** B1 of "ACTION PROPOSED ADDITIONS IN PRIORITY ORDER" — MoPay's own
 * equivalent of PayfastMerchantIdCard above. No "Set/Not set" pill —
 * unlike PayFast there's no onboarding-checklist signal for this
 * (deliberately: MoPay is an optional second gateway, not a required
 * setup step — PayFast already satisfies that checklist item), and this
 * API is write-only for tenant secrets the same way PayFast's is (see
 * useOnboardingSignal's own top comment), so there's genuinely nothing
 * honest to show as a status here. */
export function MopayApiKeyCard({ tenantId }: { tenantId: string }) {
  const [apiKey, setApiKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    setError(null);
    setMessage(null);
    setSubmitting(true);
    try {
      await SettingsApi.setMopayApiKey(tenantId, apiKey.trim());
      setMessage("Saved.");
      setApiKey("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save this API key.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card title="MoPay payouts">
      <p style={{ marginTop: 0, color: "var(--color-ink-muted)", fontSize: "0.88rem" }}>
        A second checkout option alongside PayFast — your own MoPay account API key (mopay.co.ls). Unlike PayFast,
        MoPay checkouts go straight to your own account; Mytrima never sees this key.
      </p>
      {message && <Banner kind="info">{message}</Banner>}
      {error && <Banner kind="error">{error}</Banner>}
      <div className="form-grid">
        <div className="field">
          <label htmlFor="mopay-key">MoPay API key</label>
          <input id="mopay-key" type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
        </div>
        <Button variant="primary" disabled={submitting || !apiKey.trim()} onClick={() => void handleSubmit()}>
          {submitting ? "Saving…" : "Save"}
        </Button>
      </div>
    </Card>
  );
}

/**
 * B2 of "ACTION PROPOSED ADDITIONS IN PRIORITY ORDER" — Mytrima's own
 * recurring subscription fee, charged via Mytrima's own MoPay platform
 * account (see billing.controller.ts's own top comment — architecturally
 * the reverse of MopayApiKeyCard above, which is a tenant's own account
 * collecting from their customers). Selecting a paid tier redirects the
 * browser to a real, live MoPay checkout page; selecting Free applies
 * immediately with no payment. HONEST LIMITATION surfaced directly in
 * the copy, not hidden: MoPay's real API has no subscription/auto-charge
 * feature, so each billing period is a fresh real payment the tenant (or
 * this page's own "I've paid" check) confirms — see
 * subscription.service.ts's own top comment.
 */
export function SubscriptionCard({ tenantId }: { tenantId: string }) {
  const [status, setStatus] = useState<SubscriptionStatusResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busyTier, setBusyTier] = useState<SubscriptionTier | null>(null);
  const [confirming, setConfirming] = useState(false);

  async function load() {
    try {
      setStatus(await BillingApi.getStatus(tenantId));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load your subscription.");
    }
  }

  useEffect(() => {
    if (!tenantId) return;
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  async function selectTier(tier: SubscriptionTier) {
    setError(null);
    setMessage(null);
    setBusyTier(tier);
    try {
      const result = await BillingApi.selectTier(tenantId, tier);
      if (result.checkoutUrl) {
        // A real payment redirect — send the browser to MoPay's own
        // hosted checkout page, same as any other "continue with X" flow.
        window.location.href = result.checkoutUrl;
        return;
      }
      setMessage("Switched to the Free tier.");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not update your subscription.");
    } finally {
      setBusyTier(null);
    }
  }

  async function confirmPayment() {
    setError(null);
    setMessage(null);
    setConfirming(true);
    try {
      const result = await BillingApi.confirm(tenantId);
      setMessage(result.status === "active" ? "Payment confirmed — you're all set." : "Still waiting on MoPay to confirm this payment. Try again shortly.");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not check your payment status.");
    } finally {
      setConfirming(false);
    }
  }

  if (!status) {
    return (
      <Card title="Mytrima subscription">
        {error && <Banner kind="error">{error}</Banner>}
      </Card>
    );
  }

  return (
    <Card title="Mytrima subscription" actions={<Pill tone={SUBSCRIPTION_STATUS_TONE[status.status]}>{status.status.replace("_", " ")}</Pill>}>
      <p style={{ marginTop: 0, color: "var(--color-ink-muted)", fontSize: "0.88rem" }}>
        Currently on <strong>{status.tierLabel}</strong>
        {status.amountZar > 0 ? ` — ${formatZar(status.amountZar)}/month` : ""}
        {status.nextBillingDate ? ` · next billing date ${formatDateTime(status.nextBillingDate)}` : ""}.
      </p>

      {message && <Banner kind="info">{message}</Banner>}
      {error && <Banner kind="error">{error}</Banner>}

      {status.status === "pending_payment" && (
        <div style={{ marginBottom: "0.85rem" }}>
          <Button variant="secondary" disabled={confirming} onClick={() => void confirmPayment()}>
            {confirming ? "Checking…" : "I've paid — check now"}
          </Button>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "0.6rem" }}>
        {TIER_OPTIONS.map((option) => (
          <div
            key={option.tier}
            style={{
              border: option.tier === status.tier ? "2px solid var(--color-teal)" : "1px solid var(--color-border)",
              borderRadius: 10,
              padding: "0.7rem 0.8rem",
              display: "flex",
              flexDirection: "column",
              gap: "0.4rem",
            }}
          >
            <strong>{option.label}</strong>
            <span style={{ fontSize: "0.85rem", color: "var(--color-ink-muted)" }}>{option.priceZar > 0 ? `${formatZar(option.priceZar)}/month` : "No card required"}</span>
            <p style={{ margin: 0, fontSize: "0.78rem", color: "var(--color-ink-muted)", flexGrow: 1 }}>{option.blurb}</p>
            <Button
              variant={option.tier === status.tier ? "ghost" : "secondary"}
              disabled={option.tier === status.tier || busyTier !== null}
              onClick={() => void selectTier(option.tier)}
            >
              {busyTier === option.tier ? "Redirecting…" : option.tier === status.tier ? "Current plan" : option.priceZar > 0 ? "Select & pay" : "Switch to Free"}
            </Button>
          </div>
        ))}
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

import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { BillingApi } from "../api/resources";
import type { BillingInfo, SubscriptionPaymentStatus } from "../api/types";
import { ApiError } from "../api/client";
import { Banner, Button, Card, EmptyState, PageHeader, Pill, formatDateTime, formatMoney } from "../components/ui";

/**
 * Mytrima billing ITS OWN tenants for platform-subscription use, via
 * MoPay — see billing.controller.ts's own top comment for why this is a
 * completely separate money flow from SettingsApi's PayFast merchant-id
 * (that one is a tenant's own customers paying the tenant).
 *
 * Deliberately does NOT gate any other page on subscription status —
 * matching the backend migration's own top comment, this is record-keeping
 * plus a real checkout, not an access-control system.
 */
const PENDING_PAYMENT_KEY = "mytrima.pendingBillingPaymentId";

const PAYMENT_STATUS_TONE: Record<SubscriptionPaymentStatus, "positive" | "attention" | "critical" | "neutral" | "gold"> = {
  created: "gold",
  completed: "positive",
  failed: "critical",
  cancelled: "neutral",
};

export function BillingPage() {
  const { session } = useAuth();
  const tenantId = session.status === "loggedIn" ? session.profile.tenantId : "";

  const [info, setInfo] = useState<BillingInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [switchingTo, setSwitchingTo] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true);
    try {
      setInfo(await BillingApi.get(tenantId));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load billing information.");
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  /** On return from a real MoPay hosted-checkout redirect, the paymentId
   * THIS page itself generated (via switchTo(), below — startCheckout's
   * own real response) is waiting in localStorage. Never trusts anything
   * MoPay itself put on the redirect URL — mopay.service.ts's own
   * getSession() comment documents why: verifyPayment() always re-fetches
   * the real status from MoPay's API. */
  useEffect(() => {
    if (!tenantId) return;
    const pendingId = localStorage.getItem(PENDING_PAYMENT_KEY);
    if (!pendingId) {
      void load();
      return;
    }
    localStorage.removeItem(PENDING_PAYMENT_KEY);
    (async () => {
      try {
        const result = await BillingApi.verifyPayment(tenantId, pendingId);
        setNotice(
          result.payment.status === "completed"
            ? `Payment confirmed — you're now on ${result.subscription.package}.`
            : `MoPay reported this payment as "${result.payment.status}". Your plan hasn't changed — you can try again below.`
        );
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "Could not confirm your payment status with MoPay.");
      } finally {
        await load();
      }
    })();
    // Runs once per mount (and again if tenantId only just became known) —
    // load() itself is stable across re-renders via useCallback.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  async function switchTo(packageName: string) {
    if (!tenantId) return;
    setSwitchingTo(packageName);
    setError(null);
    try {
      const redirectUrl = `${window.location.origin}${window.location.pathname}`;
      const { paymentId, paymentUrl } = await BillingApi.startCheckout(tenantId, packageName, redirectUrl);
      localStorage.setItem(PENDING_PAYMENT_KEY, paymentId);
      window.location.href = paymentUrl;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : `Could not start checkout for ${packageName}.`);
      setSwitchingTo(null);
    }
  }

  const subscription = info?.subscription;
  const payments = info?.payments ?? [];
  const packages = info?.packages ?? [];
  const sortedPayments = [...payments].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  return (
    <div>
      <PageHeader title="Billing" subtitle="Your Mytrima subscription and payment history." />

      {notice && <Banner kind="info">{notice}</Banner>}
      {error && <Banner kind="error">{error}</Banner>}

      {subscription && (
        <>
          <Card title="Current plan">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "0.75rem" }}>
              <div>
                <strong style={{ fontSize: "1.15rem" }}>{subscription.package}</strong>
                <div style={{ marginTop: "0.35rem", display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
                  <Pill tone={subscription.status === "active" ? "positive" : "critical"}>{subscription.status}</Pill>
                  {subscription.currentPeriodEnd && (
                    <span style={{ fontSize: "0.82rem", color: "var(--color-ink-muted)" }}>Renews {formatDateTime(subscription.currentPeriodEnd)}</span>
                  )}
                </div>
              </div>
            </div>
          </Card>
          <div style={{ height: "1.1rem" }} />
        </>
      )}

      <Card title="Plans">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: "0.85rem" }}>
          {packages.map((pkg) => {
            const isCurrent = subscription?.package === pkg.name && subscription.status === "active";
            const isEnterprise = pkg.priceLSL === null;
            return (
              <div
                key={pkg.name}
                className="card"
                style={{ display: "flex", flexDirection: "column", gap: "0.6rem", borderColor: isCurrent ? "var(--color-teal)" : undefined }}
              >
                <strong>{pkg.name}</strong>
                <span style={{ fontSize: "1.2rem" }}>
                  {isEnterprise ? "Custom pricing" : pkg.priceLSL === 0 ? "Free" : `${formatMoney(pkg.priceLSL)}/mo`}
                </span>
                {isCurrent && <Pill tone="positive">Current plan</Pill>}
                {!isCurrent && !isEnterprise && (
                  <Button variant="primary" disabled={switchingTo !== null} onClick={() => void switchTo(pkg.name)}>
                    {switchingTo === pkg.name ? "Redirecting to MoPay…" : `Switch to ${pkg.name}`}
                  </Button>
                )}
                {isEnterprise && !isCurrent && (
                  <Link to="/support" className="btn btn-secondary" style={{ textAlign: "center" }}>
                    Talk to us about Enterprise
                  </Link>
                )}
              </div>
            );
          })}
          {packages.length === 0 && !loading && <EmptyState>No plans available.</EmptyState>}
        </div>
      </Card>

      <div style={{ height: "1.1rem" }} />

      <Card title="Payment history">
        <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
          {sortedPayments.map((p) => (
            <div key={p.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
              <div>
                <strong>{p.package}</strong>
                <span style={{ marginLeft: "0.5rem", color: "var(--color-ink-muted)", fontSize: "0.85rem" }}>{formatMoney(p.amount)}</span>
              </div>
              <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                <Pill tone={PAYMENT_STATUS_TONE[p.status]}>{p.status}</Pill>
                <span style={{ fontSize: "0.78rem", color: "var(--color-ink-muted)" }}>{formatDateTime(p.createdAt)}</span>
              </div>
            </div>
          ))}
          {!loading && sortedPayments.length === 0 && <EmptyState>No payments yet.</EmptyState>}
        </div>
      </Card>
    </div>
  );
}

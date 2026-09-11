import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { OnboardingApi } from "../api/resources";
import type { OnboardingStatus } from "../api/types";
import { useAuth } from "../auth/AuthContext";
import { ApiError } from "../api/client";
import { Banner, Card, PageHeader, Pill } from "../components/ui";

/** Four of the five steps now have a real page in this SPA to send someone
 * to (added the Settings page 2026-09-11 for the phone/PayFast/Facebook
 * three) — only the Growth Audit questionnaire has no UI here yet (see
 * onboarding.service.ts for the five real signals this checklist reads).
 * That one renders as plain guidance text rather than a fake destination —
 * an honest reflection of `frontend/README.md`'s own disclosed gap list. */
const STEP_LINKS: Record<string, { to: string; label: string } | undefined> = {
  notification_phone: { to: "/settings", label: "Set a phone number" },
  social_connected: { to: "/settings", label: "Connect Facebook" },
  payfast_merchant_id: { to: "/settings", label: "Add merchant id" },
  first_customer: { to: "/customers", label: "Add a customer" },
};

export function OnboardingPage() {
  const { session } = useAuth();
  const tenantId = session.status === "loggedIn" ? session.profile.tenantId : "";

  const [status, setStatus] = useState<OnboardingStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!tenantId) return;
    setLoading(true);
    OnboardingApi.get(tenantId)
      .then(setStatus)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load onboarding status."))
      .finally(() => setLoading(false));
  }, [tenantId]);

  return (
    <div>
      <PageHeader title="Getting started" subtitle="A computed checklist — nothing here is a stored flag, it's read live off your actual account data each time." />

      {error && <Banner kind="error">{error}</Banner>}
      {loading && !status && <p>Loading…</p>}

      {status && (
        <>
          <Card title={`${status.completedCount} of ${status.totalCount} complete`}>
            <div
              style={{
                height: 10,
                borderRadius: 999,
                background: "var(--color-surface-sunken)",
                overflow: "hidden",
                marginBottom: "0.3rem",
              }}
            >
              <div
                style={{
                  height: "100%",
                  width: `${status.percentComplete}%`,
                  background: "var(--color-teal)",
                  transition: "width 0.3s ease",
                }}
              />
            </div>
            <p style={{ margin: 0, fontSize: "0.85rem", color: "var(--color-ink-muted)" }}>{status.percentComplete}% of the way there</p>
          </Card>

          <div style={{ height: "1.1rem" }} />

          <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
            {status.steps.map((step) => {
              const link = STEP_LINKS[step.key];
              return (
                <div className="card" key={step.key} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.75rem" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.65rem" }}>
                    <Pill tone={step.completed ? "positive" : "neutral"}>{step.completed ? "Done" : "To do"}</Pill>
                    <span>{step.label}</span>
                  </div>
                  {!step.completed && link && (
                    <Link to={link.to} style={{ fontSize: "0.85rem", fontWeight: 500 }}>
                      {link.label} →
                    </Link>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

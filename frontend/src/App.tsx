import { lazy, useEffect, useState } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { AuthProvider, useAuth } from "./auth/AuthContext";
import { LoginPage } from "./auth/LoginPage";
import { MfaEnrollPage } from "./auth/MfaEnrollPage";
import { VerifyEmailPage } from "./auth/VerifyEmailPage";
import { OnboardingWizardPage } from "./auth/OnboardingWizardPage";
import { OnboardingApi } from "./api/resources";
import { FeedbackPage } from "./pages/FeedbackPage";
import { Layout } from "./components/Layout";

/**
 * REAL GAP found by the 2026-09-11 SPA Readiness Assessment: every one of
 * the 13 pages below shipped in a single ~331 KB JS bundle (97 KB
 * gzipped) — not a problem yet at this size, but a straight line, not a
 * plateau: every future page grows what a visitor downloads on login
 * whether they ever open it or not. `lazy()` turns each page import into
 * its own chunk (Vite's own code-splitting, no extra config needed) —
 * only Auth/Layout (needed before we even know which page to show) and
 * whatever page the URL actually names load up front.
 */
const SnapshotPage = lazy(() => import("./pages/SnapshotPage").then((m) => ({ default: m.SnapshotPage })));
const GrowthActionsPage = lazy(() => import("./pages/GrowthActionsPage").then((m) => ({ default: m.GrowthActionsPage })));
const TriggersPage = lazy(() => import("./pages/TriggersPage").then((m) => ({ default: m.TriggersPage })));
const GoalsPage = lazy(() => import("./pages/GoalsPage").then((m) => ({ default: m.GoalsPage })));
const CrmPage = lazy(() => import("./pages/CrmPage").then((m) => ({ default: m.CrmPage })));
const RetentionPage = lazy(() => import("./pages/RetentionPage").then((m) => ({ default: m.RetentionPage })));
const BusinessProfilePage = lazy(() => import("./pages/BusinessProfilePage").then((m) => ({ default: m.BusinessProfilePage })));
const OnboardingPage = lazy(() => import("./pages/OnboardingPage").then((m) => ({ default: m.OnboardingPage })));
const GrowthAuditPage = lazy(() => import("./pages/GrowthAuditPage").then((m) => ({ default: m.GrowthAuditPage })));
const CustomerExperiencePage = lazy(() => import("./pages/CustomerExperiencePage").then((m) => ({ default: m.CustomerExperiencePage })));
const ReportsPage = lazy(() => import("./pages/ReportsPage").then((m) => ({ default: m.ReportsPage })));
const WebsiteAnalyticsPage = lazy(() => import("./pages/WebsiteAnalyticsPage").then((m) => ({ default: m.WebsiteAnalyticsPage })));
const MarketingInsightsPage = lazy(() => import("./pages/MarketingInsightsPage").then((m) => ({ default: m.MarketingInsightsPage })));
const POSPage = lazy(() => import("./pages/POSPage").then((m) => ({ default: m.POSPage })));
const CustomersPage = lazy(() => import("./pages/CustomersPage").then((m) => ({ default: m.CustomersPage })));
const CatalogPage = lazy(() => import("./pages/CatalogPage").then((m) => ({ default: m.CatalogPage })));
const DealsPage = lazy(() => import("./pages/DealsPage").then((m) => ({ default: m.DealsPage })));
const BookingsPage = lazy(() => import("./pages/BookingsPage").then((m) => ({ default: m.BookingsPage })));
const StaffPage = lazy(() => import("./pages/StaffPage").then((m) => ({ default: m.StaffPage })));
const SupportTicketsPage = lazy(() => import("./pages/SupportTicketsPage").then((m) => ({ default: m.SupportTicketsPage })));
const SettingsPage = lazy(() => import("./pages/SettingsPage").then((m) => ({ default: m.SettingsPage })));

/** Gatekeeper: renders the whole app tree only once we know whether there's
 * a real, currently-valid (or refreshable) session — never routes on a
 * guess. Three non-"loggedIn" states each get their own screen instead of
 * falling through to the dashboard and 401ing on every request. */
function AuthGate() {
  const { session, backToLogin } = useAuth();
  const location = useLocation();
  const tenantId = session.status === "loggedIn" ? session.profile.tenantId : null;
  // REAL BUG found live-testing this gate (2026-09-14): every wizard step
  // that actually writes anything (business profile, notification phone,
  // PayFast merchant id) is owner-gated on the backend
  // (tenant:manage_settings/social:manage — rbac.ts). A non-owner staff
  // member logging into a tenant that genuinely has no Goal/Audit yet
  // (real scenario: invited before the owner ever ran one) would hit a
  // real 403 on the wizard's very first step, with no way out. Scoped to
  // owner-only, matching MfaEnrollPage's own precedent ("a brand-new
  // OWNER's very first login") — a non-owner just sees the normal
  // dashboard instead, sparse as it is, rather than a wizard they can't
  // complete.
  const isOwner = session.status === "loggedIn" && session.profile.role === "owner";

  // Phase 8 of the GrowthOS-aligned restructuring plan
  // (C:\Users\USER\.claude\plans\twinkly-sprouting-orbit.md) — a real,
  // pre-dashboard gate for a brand-new tenant, same pattern already used
  // for mfaEnrollmentRequired below (not a redirect that could race the
  // real route render). `needsOnboarding` starts `null` ("not checked
  // yet") so a genuinely loggedIn tenant never flashes the dashboard
  // before this real check resolves. A failed check fails OPEN (treated
  // as false) — a real tenant should never be trapped behind a gate this
  // app itself couldn't load.
  const [needsOnboarding, setNeedsOnboarding] = useState<boolean | null>(null);

  useEffect(() => {
    if (!tenantId || !isOwner) {
      setNeedsOnboarding(false);
      return;
    }
    let cancelled = false;
    OnboardingApi.get(tenantId)
      .then((status) => {
        if (!cancelled) setNeedsOnboarding(status.isFirstRun);
      })
      .catch(() => {
        if (!cancelled) setNeedsOnboarding(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tenantId]);

  // Checked before every session-status branch below, regardless of
  // whether there's a session at all — a self-serve owner clicking the
  // real link they were just emailed (tenant.service.ts's
  // buildVerificationUrl()) has no session yet by definition, and even a
  // currently-logged-in owner re-clicking a stale link (an old tab, a
  // security scanner pre-fetch) should still land here rather than being
  // silently redirected to the dashboard mid-flow.
  if (location.pathname === "/verify-email") {
    return <VerifyEmailPage />;
  }

  // Same reasoning as /verify-email above, checked the same way (before
  // every session-status branch, regardless of whether this browser
  // happens to ALSO be logged into a Mytrima staff account) — a customer
  // clicking a feedback link from WhatsApp/email/SMS has no Mytrima
  // account and never will (see FeedbackPage.tsx's own top comment).
  // `startsWith`, not an exact match, since the real URL carries
  // :tenantId/:customerId — matched properly by <Route> once rendered.
  if (location.pathname.startsWith("/feedback/")) {
    return (
      <Routes>
        <Route path="/feedback/:tenantId/:customerId" element={<FeedbackPage />} />
      </Routes>
    );
  }

  if (session.status === "loading") {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--color-ink-muted)" }}>
        Loading Mytrima…
      </div>
    );
  }

  if (session.status === "loggedOut") {
    return <LoginPage />;
  }

  if (session.status === "mfaEnrollmentRequired") {
    return <MfaEnrollPage enrollmentToken={session.enrollmentToken} onDone={backToLogin} />;
  }

  if (needsOnboarding === null) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--color-ink-muted)" }}>
        Loading Mytrima…
      </div>
    );
  }

  if (needsOnboarding) {
    return <OnboardingWizardPage onComplete={() => setNeedsOnboarding(false)} />;
  }

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<SnapshotPage />} />
        <Route path="/growth-actions" element={<GrowthActionsPage />} />
        <Route path="/triggers" element={<TriggersPage />} />
        <Route path="/goals" element={<GoalsPage />} />
        <Route path="/crm" element={<CrmPage />} />
        <Route path="/retention" element={<RetentionPage />} />
        <Route path="/business-profile" element={<BusinessProfilePage />} />
        <Route path="/onboarding" element={<OnboardingPage />} />
        <Route path="/growth-audit" element={<GrowthAuditPage />} />
        <Route path="/customer-experience" element={<CustomerExperiencePage />} />
        <Route path="/reports" element={<ReportsPage />} />
        <Route path="/website-analytics" element={<WebsiteAnalyticsPage />} />
        <Route path="/marketing-insights" element={<MarketingInsightsPage />} />
        <Route path="/pos" element={<POSPage />} />
        <Route path="/customers" element={<CustomersPage />} />
        <Route path="/catalog" element={<CatalogPage />} />
        <Route path="/deals" element={<DealsPage />} />
        <Route path="/bookings" element={<BookingsPage />} />
        <Route path="/staff" element={<StaffPage />} />
        <Route path="/support" element={<SupportTicketsPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

export function App() {
  return (
    <AuthProvider>
      <AuthGate />
    </AuthProvider>
  );
}

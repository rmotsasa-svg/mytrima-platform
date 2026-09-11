import { Suspense, useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { Button } from "./ui";
import { ErrorBoundary } from "./ErrorBoundary";
import "./Layout.css";

const NAV_ITEMS: { to: string; label: string }[] = [
  { to: "/", label: "Snapshot" },
  { to: "/business-profile", label: "Business profile" },
  { to: "/onboarding", label: "Getting started" },
  { to: "/growth-audit", label: "Growth audit" },
  { to: "/customer-experience", label: "Customer experience" },
  { to: "/reports", label: "Reports" },
  { to: "/website-analytics", label: "Website analytics" },
  { to: "/sales", label: "Sales" },
  { to: "/customers", label: "Customers" },
  { to: "/catalog", label: "Catalog" },
  { to: "/bookings", label: "Bookings" },
  { to: "/staff", label: "Staff" },
  { to: "/support", label: "Support" },
  { to: "/settings", label: "Settings" },
];

export function Layout() {
  const { session, logout } = useAuth();
  const location = useLocation();
  const profile = session.status === "loggedIn" ? session.profile : null;

  /** REAL GAP found by the 2026-09-11 SPA Readiness Assessment: at a real
   * 375px viewport, the old always-visible horizontal nav strip overflowed
   * with no scroll affordance — only 3 of 12 links fit, and Sign out
   * scrolled fully out of reach with no visible cue it was even there.
   * Below 760px (Layout.css's own breakpoint) the nav is now a collapsed
   * drawer instead: closed by default, opened by this toggle, and closed
   * again automatically on navigation (the effect below) or by tapping the
   * scrim — never left open pointing at a page the user already left. */
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  useEffect(() => {
    setMobileNavOpen(false);
  }, [location.pathname]);

  return (
    <div className="shell">
      <aside className={mobileNavOpen ? "shell-nav mobile-open" : "shell-nav"}>
        <div className="shell-nav-header">
          <div className="shell-brand">
            <img src="/brand/lockup-horizontal-dark-compact.svg" alt="Mytrima" />
          </div>
          <button
            type="button"
            className="shell-nav-toggle"
            aria-expanded={mobileNavOpen}
            aria-label={mobileNavOpen ? "Close menu" : "Open menu"}
            onClick={() => setMobileNavOpen((open) => !open)}
          >
            <span />
            <span />
            <span />
          </button>
        </div>
        <div className="shell-nav-body">
          <nav>
            {NAV_ITEMS.map((item) => (
              <NavLink key={item.to} to={item.to} end={item.to === "/"} className={({ isActive }) => (isActive ? "shell-link active" : "shell-link")}>
                {item.label}
              </NavLink>
            ))}
          </nav>
          <div className="shell-account">
            {profile && (
              <>
                <div className="shell-account-email">{profile.email}</div>
                <div className="shell-account-role">{profile.role.replace("_", " ")}</div>
              </>
            )}
            <Button variant="ghost" onClick={() => void logout()}>
              Sign out
            </Button>
          </div>
        </div>
      </aside>
      {mobileNavOpen && <div className="shell-scrim" onClick={() => setMobileNavOpen(false)} aria-hidden="true" />}
      <main className="shell-content">
        <ErrorBoundary key={location.pathname}>
          {/* Suspense catches the lazy() page chunks App.tsx now loads
              per-route — lives here, not around the whole Routes tree in
              App.tsx, so only this content area shows "Loading…" while a
              chunk fetches; the sidebar (and its nav/account/sign-out)
              stays mounted and interactive throughout. */}
          <Suspense fallback={<p style={{ color: "var(--color-ink-muted)" }}>Loading…</p>}>
            <Outlet />
          </Suspense>
        </ErrorBoundary>
      </main>
    </div>
  );
}

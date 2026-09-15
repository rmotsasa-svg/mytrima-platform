import { Suspense, useEffect, useRef, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { Button } from "./ui";
import { ErrorBoundary } from "./ErrorBoundary";
import { NavIcon, type NavIconName } from "./icons";
import "./Layout.css";

/**
 * Grouped 2026-09-14 — Phase 1 of the GrowthOS-aligned IA restructuring
 * plan (see the session's own plan doc). Groups reflect the growth loop
 * (Understand -> Diagnose -> Prioritize -> Act -> Measure) the platform is
 * organized around, not an alphabetical or build-order listing. Every
 * route from the old flat NAV_ITEMS list is still here — this is a
 * presentation change only, no route in App.tsx moved or was removed.
 *
 * "Operations" is a real, deliberate group this plan's own source
 * document (a GrowthOS page-architecture proposal) never accounted for:
 * POS, Staff, and Support are live, load-bearing day-to-day modules for a
 * Lesotho SME, not strategic/analytics tooling, and dropping them from
 * the IA would have orphaned real, already-shipped features.
 *
 * "Getting started" is deliberately NOT in this list — Phase 8 of the
 * plan replaces the permanent sidebar entry with a first-run wizard that
 * fires automatically for a brand-new tenant; the same computed checklist
 * will stay reachable from Settings for anyone who skips it. Until Phase
 * 8 ships, the route itself (`/onboarding`) still exists and still works
 * (see App.tsx) — only its sidebar entry is gone, so it stays reachable
 * from OnboardingPage.tsx's own existing links (e.g. SettingsPage.tsx's
 * live status badges) even mid-migration.
 */
interface NavGroup {
  label: string;
  items: { to: string; label: string; icon: NavIconName }[];
}

const NAV_GROUPS: NavGroup[] = [
  { label: "", items: [{ to: "/", label: "Dashboard", icon: "dashboard" }] },
  {
    label: "Growth",
    items: [
      { to: "/growth-audit", label: "Growth audit", icon: "audit" },
      { to: "/goals", label: "Goals", icon: "goals" },
      { to: "/growth-actions", label: "Growth actions", icon: "actions" },
      { to: "/triggers", label: "Triggers", icon: "triggers" },
    ],
  },
  {
    label: "Customers",
    items: [
      { to: "/crm", label: "CRM", icon: "crm" },
      { to: "/customers", label: "Customers", icon: "customers" },
      { to: "/retention", label: "Retention", icon: "retention" },
    ],
  },
  {
    label: "Revenue",
    items: [
      { to: "/pos", label: "P.O.S.", icon: "pos" },
      { to: "/catalog", label: "Catalog", icon: "catalog" },
      { to: "/deals", label: "Deals & promotions", icon: "deals" },
    ],
  },
  {
    label: "Marketing",
    items: [
      { to: "/marketing-insights", label: "Marketing & brand insights", icon: "marketing" },
      { to: "/website-analytics", label: "Website analytics", icon: "analytics" },
    ],
  },
  {
    label: "Experience",
    items: [{ to: "/customer-experience", label: "Customer experience", icon: "experience" }],
  },
  {
    label: "Operations",
    items: [
      { to: "/bookings", label: "Bookings", icon: "bookings" },
      { to: "/staff", label: "Staff", icon: "staff" },
      { to: "/support", label: "Support", icon: "support" },
    ],
  },
  {
    label: "Intelligence",
    items: [{ to: "/reports", label: "Reports & intelligence", icon: "reports" }],
  },
  {
    label: "Settings",
    items: [
      { to: "/business-profile", label: "Business profile", icon: "business" },
      { to: "/settings", label: "Settings", icon: "settings" },
    ],
  },
];

/** Which group (by label) a given path belongs to — used to keep the
 * currently-viewed page's group expanded even if the tenant collapsed it
 * earlier, so navigating never hides the very link you're standing on. */
function groupLabelForPath(pathname: string): string | undefined {
  return NAV_GROUPS.find((g) => g.items.some((item) => (item.to === "/" ? pathname === "/" : pathname.startsWith(item.to))))?.label;
}

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

  /** "Apply dropdown [to the] main [nav]" — the tenant's own explicit
   * request (2026-09-15): each group header is now a real collapse/expand
   * toggle instead of a static label, default all-expanded (unchanged from
   * before this — nothing starts hidden). Storing which groups are
   * collapsed (not which are expanded) means a brand-new group added later
   * defaults to visible without this list needing to know about it. */
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  useEffect(() => {
    const activeGroup = groupLabelForPath(location.pathname);
    if (activeGroup && collapsedGroups.has(activeGroup)) {
      setCollapsedGroups((prev) => {
        const next = new Set(prev);
        next.delete(activeGroup);
        return next;
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  function toggleGroup(label: string) {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  }

  /** Account menu as a dropdown — the tenant's own explicit request
   * (2026-09-15): email/role/sign-out no longer sit permanently at the
   * bottom of the sidebar, only a compact account trigger does; clicking it
   * reveals the same information and the same Sign out action in a panel.
   * Closes on an outside click (the same pattern this file already uses
   * for the mobile nav's scrim) and on navigation, so it never stays open
   * pointing at a page the tenant already left. */
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const accountMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setAccountMenuOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!accountMenuOpen) return;
    function handleOutsideClick(e: MouseEvent) {
      if (accountMenuRef.current && !accountMenuRef.current.contains(e.target as Node)) {
        setAccountMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, [accountMenuOpen]);

  return (
    <div className="shell">
      <aside className={mobileNavOpen ? "shell-nav mobile-open" : "shell-nav"}>
        <div className="shell-nav-header">
          <div className="shell-brand">
            {/* No "compact, wordmark-only" file exists in the new mark
             * set (updated 2026-09-12 — real PNGs, no vector source) the
             * way the old hand-drawn lockup-horizontal-dark-compact.svg
             * was. Same content as that file had (mark + wordmark, no
             * tagline — there's no room for one at sidebar height): the
             * new white icon mark, real HTML text next to it in the
             * site's own display font rather than baked into a raster,
             * so it stays crisp at any size. */}
            <img src="/brand/icon-mark-white.png" alt="" className="shell-brand-mark" />
            <span className="shell-brand-word">Mytrima</span>
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
            {NAV_GROUPS.map((group) => {
              const collapsed = group.label !== "" && collapsedGroups.has(group.label);
              return (
                <div className="shell-nav-group" key={group.label || "root"}>
                  {group.label && (
                    <button type="button" className="shell-nav-group-label" aria-expanded={!collapsed} onClick={() => toggleGroup(group.label)}>
                      <span>{group.label}</span>
                      <NavIcon name="chevron" className={collapsed ? "shell-nav-group-chevron collapsed" : "shell-nav-group-chevron"} />
                    </button>
                  )}
                  {!collapsed &&
                    group.items.map((item) => (
                      <NavLink key={item.to} to={item.to} end={item.to === "/"} className={({ isActive }) => (isActive ? "shell-link active" : "shell-link")}>
                        <NavIcon name={item.icon} />
                        <span>{item.label}</span>
                      </NavLink>
                    ))}
                </div>
              );
            })}
          </nav>
          <div className="shell-account" ref={accountMenuRef}>
            <button type="button" className="shell-account-trigger" aria-expanded={accountMenuOpen} onClick={() => setAccountMenuOpen((open) => !open)}>
              <NavIcon name="account" />
              <span className="shell-account-trigger-label">{profile ? profile.role.replace("_", " ") : "Account"}</span>
              <NavIcon name="chevron" className={accountMenuOpen ? "shell-nav-group-chevron" : "shell-nav-group-chevron collapsed"} />
            </button>
            {accountMenuOpen && (
              <div className="shell-account-menu">
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
            )}
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

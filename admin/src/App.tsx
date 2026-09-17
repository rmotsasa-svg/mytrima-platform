import { NavLink, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "./auth/AuthContext";
import { LoginPage } from "./auth/LoginPage";
import { MfaEnrollPage } from "./auth/MfaEnrollPage";
import { HomePage } from "./pages/HomePage";
import { TenantsPage } from "./pages/TenantsPage";
import { Button } from "./components/ui";

/** Real routing added for Phase 2 of the admin-platform plan — Phase 1
 * left this as a bare AuthGate with a single page since there was only
 * one to show. Deliberately a plain top nav, not frontend/'s own
 * Layout.tsx sidebar shell (icons, collapsible groups, mobile drawer) —
 * that shell earns its complexity across a dozen tenant-facing routes;
 * this app has two. */
function Shell() {
  const { session, logout } = useAuth();
  const email = session.status === "loggedIn" ? session.profile.email : "";

  return (
    <div>
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0.9rem 1.5rem",
          borderBottom: "1px solid var(--color-border)",
          background: "var(--color-surface)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "1.5rem" }}>
          <span style={{ fontWeight: 700, color: "var(--color-teal)" }}>Mytrima Admin</span>
          <nav style={{ display: "flex", gap: "1rem" }}>
            <NavLink to="/" end style={({ isActive }) => ({ color: isActive ? "var(--color-teal)" : "var(--color-ink-muted)", fontWeight: isActive ? 600 : 400 })}>
              Home
            </NavLink>
            <NavLink
              to="/tenants"
              style={({ isActive }) => ({ color: isActive ? "var(--color-teal)" : "var(--color-ink-muted)", fontWeight: isActive ? 600 : 400 })}
            >
              Tenants
            </NavLink>
          </nav>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", fontSize: "0.85rem", color: "var(--color-ink-muted)" }}>
          <span>{email}</span>
          <Button variant="ghost" onClick={() => void logout()}>
            Sign out
          </Button>
        </div>
      </header>
      <main style={{ maxWidth: 1100, margin: "2rem auto", padding: "0 1.5rem" }}>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/tenants" element={<TenantsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}

/** Simplified sibling of frontend/src/App.tsx's own AuthGate — no
 * onboarding wizard, no email verification, no feedback route (none of
 * those tenant-specific concepts apply to an admin session). Same real
 * discipline though: render the tree only once session status is known,
 * never route on a guess. */
function AuthGate() {
  const { session, backToLogin } = useAuth();

  if (session.status === "loading") {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--color-ink-muted)" }}>
        Loading Mytrima Admin…
      </div>
    );
  }

  if (session.status === "loggedOut") {
    return <LoginPage />;
  }

  if (session.status === "mfaEnrollmentRequired") {
    return <MfaEnrollPage enrollmentToken={session.enrollmentToken} onDone={backToLogin} />;
  }

  return <Shell />;
}

export function App() {
  return (
    <AuthProvider>
      <AuthGate />
    </AuthProvider>
  );
}

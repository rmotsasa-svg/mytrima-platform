import { AuthProvider, useAuth } from "./auth/AuthContext";
import { LoginPage } from "./auth/LoginPage";
import { MfaEnrollPage } from "./auth/MfaEnrollPage";
import { HomePage } from "./pages/HomePage";

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

  return <HomePage />;
}

export function App() {
  return (
    <AuthProvider>
      <AuthGate />
    </AuthProvider>
  );
}

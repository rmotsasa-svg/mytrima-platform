import { Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "./auth/AuthContext";
import { LoginPage } from "./auth/LoginPage";
import { MfaEnrollPage } from "./auth/MfaEnrollPage";
import { Layout } from "./components/Layout";
import { SnapshotPage } from "./pages/SnapshotPage";
import { SalesPage } from "./pages/SalesPage";
import { CustomersPage } from "./pages/CustomersPage";
import { CatalogPage } from "./pages/CatalogPage";
import { BookingsPage } from "./pages/BookingsPage";
import { StaffPage } from "./pages/StaffPage";
import { SupportTicketsPage } from "./pages/SupportTicketsPage";

/** Gatekeeper: renders the whole app tree only once we know whether there's
 * a real, currently-valid (or refreshable) session — never routes on a
 * guess. Three non-"loggedIn" states each get their own screen instead of
 * falling through to the dashboard and 401ing on every request. */
function AuthGate() {
  const { session, backToLogin } = useAuth();

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

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<SnapshotPage />} />
        <Route path="/sales" element={<SalesPage />} />
        <Route path="/customers" element={<CustomersPage />} />
        <Route path="/catalog" element={<CatalogPage />} />
        <Route path="/bookings" element={<BookingsPage />} />
        <Route path="/staff" element={<StaffPage />} />
        <Route path="/support" element={<SupportTicketsPage />} />
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

import { useAuth } from "../auth/AuthContext";
import { useNavigate } from "react-router-dom";
import { Button, Card, PageHeader } from "../components/ui";

/** Phase 2 adds real tenant management (see TenantsPage) — this page is
 * now the landing screen pointing at it, rather than Phase 1's own bare
 * "Signed in as" placeholder. Platform performance (Phase 3) lands here
 * next. */
export function HomePage() {
  const { session } = useAuth();
  const navigate = useNavigate();
  const email = session.status === "loggedIn" ? session.profile.email : "";

  return (
    <div style={{ maxWidth: 640, margin: 0 }}>
      <PageHeader title="Mytrima Admin" subtitle="Platform administration for the Mytrima operator team." />
      <Card title="Signed in">
        <p style={{ marginTop: 0 }}>
          Signed in as <strong>{email}</strong>.
        </p>
        <p style={{ color: "var(--color-ink-muted)", fontSize: "0.88rem" }}>Platform performance is coming in the next phase of this app.</p>
        <Button variant="primary" onClick={() => navigate("/tenants")}>
          Manage tenants
        </Button>
      </Card>
    </div>
  );
}

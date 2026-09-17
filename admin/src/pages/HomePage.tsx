import { useAuth } from "../auth/AuthContext";
import { useNavigate } from "react-router-dom";
import { Button, Card, PageHeader } from "../components/ui";

/** Phase 2 added real tenant management (TenantsPage), Phase 3 added
 * real platform performance (PlatformHealthPage) — this landing screen
 * just points at both, replacing Phase 1's own bare "Signed in as"
 * placeholder. */
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
        <div style={{ display: "flex", gap: "0.6rem", flexWrap: "wrap" }}>
          <Button variant="primary" onClick={() => navigate("/tenants")}>
            Manage tenants
          </Button>
          <Button variant="secondary" onClick={() => navigate("/platform-health")}>
            Platform performance
          </Button>
        </div>
      </Card>
    </div>
  );
}

import { useAuth } from "../auth/AuthContext";
import { Button, Card, PageHeader } from "../components/ui";

/** Phase 1's own scope on purpose — "a bare 'Signed in as {email}' landing
 * page, proves the whole auth loop works end-to-end before Phase 2 builds
 * anything real on top" (see the plan). Tenant management and platform
 * performance land here in later phases. */
export function HomePage() {
  const { session, logout } = useAuth();
  const email = session.status === "loggedIn" ? session.profile.email : "";

  return (
    <div style={{ maxWidth: 640, margin: "3rem auto", padding: "0 1.5rem" }}>
      <PageHeader title="Mytrima Admin" subtitle="Platform administration for the Mytrima operator team." />
      <Card title="Signed in">
        <p style={{ marginTop: 0 }}>
          Signed in as <strong>{email}</strong>.
        </p>
        <p style={{ color: "var(--color-ink-muted)", fontSize: "0.88rem" }}>
          Tenant management and platform performance are coming in the next phases of this app.
        </p>
        <Button variant="secondary" onClick={() => void logout()}>
          Sign out
        </Button>
      </Card>
    </div>
  );
}

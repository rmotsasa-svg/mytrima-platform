import { useEffect, useState } from "react";
import { CustomersApi } from "../api/resources";
import type { Customer } from "../api/types";
import { useAuth } from "../auth/AuthContext";
import { ApiError } from "../api/client";
import { Banner, Button, Card, EmptyState, PageHeader, formatDateTime } from "../components/ui";

export function CustomersPage() {
  const { session } = useAuth();
  const tenantId = session.status === "loggedIn" ? session.profile.tenantId : "";
  const canManage = session.status === "loggedIn" && session.profile.role !== "read_only";

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);

  async function load(q?: string) {
    if (!tenantId) return;
    setLoading(true);
    try {
      setCustomers(await CustomersApi.list(tenantId, q || undefined));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load customers.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  return (
    <div>
      <PageHeader
        title="Customers"
        subtitle={`${customers.length} shown`}
        actions={
          canManage && (
            <Button variant="primary" onClick={() => setShowForm((s) => !s)}>
              {showForm ? "Cancel" : "Add customer"}
            </Button>
          )
        }
      />

      {error && <Banner kind="error">{error}</Banner>}

      {showForm && (
        <>
          <NewCustomerForm
            onCreated={() => {
              setShowForm(false);
              void load(query);
            }}
          />
          <div style={{ height: "1.1rem" }} />
        </>
      )}

      <div className="field" style={{ maxWidth: 320, marginBottom: "0.9rem" }}>
        <label htmlFor="customer-search">Search</label>
        <input
          id="customer-search"
          placeholder="Name, phone, or email"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void load(query);
          }}
          onBlur={() => void load(query)}
        />
      </div>

      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Phone</th>
              <th>Email</th>
              <th>Customer since</th>
            </tr>
          </thead>
          <tbody>
            {customers.map((c) => (
              <tr key={c.id}>
                <td>{c.displayName ?? "—"}</td>
                <td>{c.phone ?? "—"}</td>
                <td>{c.email ?? "—"}</td>
                <td>{formatDateTime(c.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!loading && customers.length === 0 && <EmptyState>No customers match yet.</EmptyState>}
      </div>
    </div>
  );
}

function NewCustomerForm({ onCreated }: { onCreated: () => void }) {
  const [displayName, setDisplayName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    if (!displayName.trim() && !phone.trim() && !email.trim()) {
      setError("Give at least a name, phone, or email.");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      await CustomersApi.create({ displayName: displayName || undefined, phone: phone || undefined, email: email || undefined });
      setDisplayName("");
      setPhone("");
      setEmail("");
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not add this customer.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card title="Add a customer">
      {error && <Banner kind="error">{error}</Banner>}
      <div className="form-grid">
        <div className="field">
          <label htmlFor="new-cust-name">Name</label>
          <input id="new-cust-name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="new-cust-phone">Phone</label>
          <input id="new-cust-phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="new-cust-email">Email</label>
          <input id="new-cust-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <Button variant="primary" disabled={submitting} onClick={() => void handleSubmit()}>
          {submitting ? "Adding…" : "Add customer"}
        </Button>
      </div>
    </Card>
  );
}

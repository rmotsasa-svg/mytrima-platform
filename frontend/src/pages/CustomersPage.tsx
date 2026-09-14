import { Fragment, useEffect, useState } from "react";
import { CustomersApi } from "../api/resources";
import type { Customer, CustomerActivity } from "../api/types";
import { useAuth } from "../auth/AuthContext";
import { ApiError } from "../api/client";
import { Banner, Button, Card, EmptyState, PageHeader, Pill, formatDateTime, formatMoney } from "../components/ui";

export function CustomersPage() {
  const { session } = useAuth();
  const tenantId = session.status === "loggedIn" ? session.profile.tenantId : "";
  const canManage = session.status === "loggedIn" && session.profile.role !== "read_only";

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

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
              <th></th>
            </tr>
          </thead>
          <tbody>
            {customers.map((c) =>
              editingId === c.id ? (
                <EditCustomerRow
                  key={c.id}
                  tenantId={tenantId}
                  customer={c}
                  onSaved={() => {
                    setEditingId(null);
                    void load(query);
                  }}
                  onCancel={() => setEditingId(null)}
                />
              ) : (
                <Fragment key={c.id}>
                  <tr>
                    <td>{c.displayName ?? "—"}</td>
                    <td>{c.phone ?? "—"}</td>
                    <td>{c.email ?? "—"}</td>
                    <td>{formatDateTime(c.createdAt)}</td>
                    <td>
                      <div style={{ display: "flex", gap: "0.4rem" }}>
                        {canManage && (
                          <Button variant="ghost" onClick={() => setEditingId(c.id)}>
                            Edit
                          </Button>
                        )}
                        <Button variant="ghost" onClick={() => setExpandedId((id) => (id === c.id ? null : c.id))}>
                          {expandedId === c.id ? "Hide history" : "History"}
                        </Button>
                      </div>
                    </td>
                  </tr>
                  {expandedId === c.id && (
                    <tr>
                      <td colSpan={5} style={{ background: "var(--color-surface-sunken)" }}>
                        <CustomerHistoryPanel tenantId={tenantId} customerId={c.id} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            )}
          </tbody>
        </table>
        {!loading && customers.length === 0 && <EmptyState>No customers match yet.</EmptyState>}
      </div>
    </div>
  );
}

/** Real gap closed 2026-09-14 at the tenant's own request — CustomersApi.update()
 * already existed on the backend (CustomerService.update()'s own real PATCH
 * semantics) but nothing here ever let a tenant edit a customer's own
 * details. A field left blank here is sent as an empty string, which
 * CustomerService.update() treats as an explicit clear (its own comment) —
 * matching what a tenant blanking out a field in this row actually means. */
function EditCustomerRow({
  tenantId,
  customer,
  onSaved,
  onCancel,
}: {
  tenantId: string;
  customer: Customer;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [displayName, setDisplayName] = useState(customer.displayName ?? "");
  const [phone, setPhone] = useState(customer.phone ?? "");
  const [email, setEmail] = useState(customer.email ?? "");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSave() {
    setError(null);
    setSubmitting(true);
    try {
      await CustomersApi.update(tenantId, customer.id, { displayName, phone, email });
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save this customer.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <tr>
      <td colSpan={5}>
        {error && <Banner kind="error">{error}</Banner>}
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
          <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Name" style={{ width: "10rem" }} />
          <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone" style={{ width: "9rem" }} />
          <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" type="email" style={{ width: "12rem" }} />
          <Button variant="primary" disabled={submitting} onClick={() => void handleSave()}>
            {submitting ? "Saving…" : "Save"}
          </Button>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </td>
    </tr>
  );
}

/** Real gap closed 2026-09-14 at the tenant's own request ("add customer
 * history") — CustomerController.activity() already assembled real ratings/
 * consent records; sales and booking history are new on that same endpoint
 * (see its own comment). This panel is the only place any of that renders. */
function CustomerHistoryPanel({ tenantId, customerId }: { tenantId: string; customerId: string }) {
  const [activity, setActivity] = useState<CustomerActivity | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    CustomersApi.activity(tenantId, customerId)
      .then((a) => !cancelled && setActivity(a))
      .catch((err) => !cancelled && setError(err instanceof ApiError ? err.message : "Could not load this customer's history."));
    return () => {
      cancelled = true;
    };
  }, [tenantId, customerId]);

  if (error) return <Banner kind="error">{error}</Banner>;
  if (!activity) return <p style={{ margin: "0.5rem 0", fontSize: "0.85rem", color: "var(--color-ink-muted)" }}>Loading…</p>;

  return (
    <div style={{ padding: "0.75rem 0", display: "flex", flexDirection: "column", gap: "0.9rem" }}>
      <div>
        <p style={{ margin: "0 0 0.35rem", fontWeight: 600, fontSize: "0.85rem" }}>Sales ({activity.sales.length})</p>
        {activity.sales.length === 0 ? (
          <p style={{ margin: 0, fontSize: "0.8rem", color: "var(--color-ink-muted)" }}>No sales recorded for this customer yet.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>
            {activity.sales.map((s) => (
              <div key={s.id} style={{ fontSize: "0.82rem", display: "flex", gap: "0.6rem" }}>
                <span style={{ color: "var(--color-ink-muted)" }}>{formatDateTime(s.occurredAt)}</span>
                <span className="tabular">{formatMoney(s.totalAmount)}</span>
                <span style={{ color: "var(--color-ink-muted)" }}>
                  {s.lineItems.map((li) => li.description ?? `${li.quantity}×item`).join(", ")}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
      <div>
        <p style={{ margin: "0 0 0.35rem", fontWeight: 600, fontSize: "0.85rem" }}>Bookings ({activity.bookings.length})</p>
        {activity.bookings.length === 0 ? (
          <p style={{ margin: 0, fontSize: "0.8rem", color: "var(--color-ink-muted)" }}>No bookings for this customer yet.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>
            {activity.bookings.map((b) => (
              <div key={b.id} style={{ fontSize: "0.82rem", display: "flex", gap: "0.6rem", alignItems: "center" }}>
                <span style={{ color: "var(--color-ink-muted)" }}>{formatDateTime(b.scheduledAt)}</span>
                <Pill tone={b.status === "completed" ? "positive" : b.status === "cancelled" ? "critical" : "neutral"}>{b.status.replace("_", " ")}</Pill>
              </div>
            ))}
          </div>
        )}
      </div>
      <div>
        <p style={{ margin: "0 0 0.35rem", fontWeight: 600, fontSize: "0.85rem" }}>Ratings ({activity.ratings.length})</p>
        {activity.ratings.length === 0 ? (
          <p style={{ margin: 0, fontSize: "0.8rem", color: "var(--color-ink-muted)" }}>No ratings from this customer yet.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>
            {activity.ratings.map((r) => (
              <div key={r.id} style={{ fontSize: "0.82rem", display: "flex", gap: "0.6rem" }}>
                <span style={{ color: "var(--color-ink-muted)" }}>{formatDateTime(r.submittedAt)}</span>
                <span>{"★".repeat(r.stars)}</span>
                {r.comment && <span style={{ color: "var(--color-ink-muted)" }}>"{r.comment}"</span>}
              </div>
            ))}
          </div>
        )}
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

import { useEffect, useState } from "react";
import { BookingsApi, CatalogApi, CustomersApi } from "../api/resources";
import type { Booking, BookingStatus, CatalogItem, Customer } from "../api/types";
import { useAuth } from "../auth/AuthContext";
import { ApiError } from "../api/client";
import { Banner, Button, Card, EmptyState, PageHeader, Pill, formatDateTime } from "../components/ui";

const STATUS_TONE: Record<BookingStatus, "positive" | "attention" | "critical" | "neutral" | "gold"> = {
  requested: "gold",
  confirmed: "positive",
  completed: "neutral",
  cancelled: "critical",
  no_show: "attention",
};

export function BookingsPage() {
  const { session } = useAuth();
  const tenantId = session.status === "loggedIn" ? session.profile.tenantId : "";
  const canManage = session.status === "loggedIn" && session.profile.role !== "read_only";

  const [bookings, setBookings] = useState<Booking[]>([]);
  const [customers, setCustomers] = useState<Record<string, Customer>>({});
  const [items, setItems] = useState<Record<string, CatalogItem>>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  async function load() {
    if (!tenantId) return;
    setLoading(true);
    try {
      const [bookingList, customerList, catalogList] = await Promise.all([
        BookingsApi.list(tenantId),
        CustomersApi.list(tenantId),
        CatalogApi.list(tenantId),
      ]);
      setBookings(bookingList);
      setCustomers(Object.fromEntries(customerList.map((c) => [c.id, c])));
      setItems(Object.fromEntries(catalogList.map((i) => [i.id, i])));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load bookings.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  async function act(bookingId: string, action: "confirm" | "cancel" | "complete" | "markNoShow") {
    setBusyId(bookingId);
    setError(null);
    try {
      await BookingsApi[action](tenantId, bookingId);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not update this booking.");
    } finally {
      setBusyId(null);
    }
  }

  const sorted = [...bookings].sort((a, b) => new Date(b.scheduledAt).getTime() - new Date(a.scheduledAt).getTime());

  return (
    <div>
      <PageHeader
        title="Bookings"
        subtitle="Customer-requested appointments — customers submit these themselves, no Mytrima account needed."
        actions={
          canManage && (
            <Button variant="primary" onClick={() => setShowForm((s) => !s)}>
              {showForm ? "Cancel" : "Book for a customer"}
            </Button>
          )
        }
      />
      {error && <Banner kind="error">{error}</Banner>}
      {showForm && (
        <>
          <NewBookingForm
            tenantId={tenantId}
            customers={Object.values(customers)}
            catalog={Object.values(items)}
            onCreated={() => {
              setShowForm(false);
              void load();
            }}
          />
          <div style={{ height: "1.1rem" }} />
        </>
      )}
      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th>Scheduled</th>
              <th>Customer</th>
              <th>Service</th>
              <th>Duration</th>
              <th>Status</th>
              {canManage && <th>Actions</th>}
            </tr>
          </thead>
          <tbody>
            {sorted.map((b) => (
              <tr key={b.id}>
                <td>{formatDateTime(b.scheduledAt)}</td>
                <td>{customers[b.customerId]?.displayName ?? customers[b.customerId]?.phone ?? b.customerId}</td>
                <td>{items[b.catalogItemId]?.name ?? b.catalogItemId}</td>
                <td>{b.durationMinutes} min</td>
                <td>
                  <Pill tone={STATUS_TONE[b.status]}>{b.status.replace("_", " ")}</Pill>
                </td>
                {canManage && (
                  <td style={{ display: "flex", gap: "0.35rem", flexWrap: "wrap" }}>
                    {b.status === "requested" && (
                      <>
                        <Button variant="primary" disabled={busyId === b.id} onClick={() => void act(b.id, "confirm")}>
                          Confirm
                        </Button>
                        <Button variant="danger" disabled={busyId === b.id} onClick={() => void act(b.id, "cancel")}>
                          Decline
                        </Button>
                      </>
                    )}
                    {b.status === "confirmed" && (
                      <>
                        <Button variant="primary" disabled={busyId === b.id} onClick={() => void act(b.id, "complete")}>
                          Complete
                        </Button>
                        <Button variant="secondary" disabled={busyId === b.id} onClick={() => void act(b.id, "markNoShow")}>
                          No-show
                        </Button>
                        <Button variant="danger" disabled={busyId === b.id} onClick={() => void act(b.id, "cancel")}>
                          Cancel
                        </Button>
                      </>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        {!loading && sorted.length === 0 && <EmptyState>No booking requests yet.</EmptyState>}
      </div>
    </div>
  );
}

/** Real gap closed 2026-09-14 at the tenant's own request: previously the
 * only way a booking entered this system was a customer submitting the
 * public, unauthenticated request() endpoint themselves — there was no way
 * for staff to just book a walk-in or a phone call directly. Calls
 * BookingsApi.createByStaff(), which lands the booking already "confirmed"
 * (see BookingService.createByStaff()'s own comment) — no separate
 * confirm step, since staff creating it directly IS the confirmation. */
function NewBookingForm({
  tenantId,
  customers,
  catalog,
  onCreated,
}: {
  tenantId: string;
  customers: Customer[];
  catalog: CatalogItem[];
  onCreated: () => void;
}) {
  const [customerId, setCustomerId] = useState(customers[0]?.id ?? "");
  const [catalogItemId, setCatalogItemId] = useState(catalog[0]?.id ?? "");
  const [scheduledAt, setScheduledAt] = useState("");
  const [durationMinutes, setDurationMinutes] = useState<number | "">("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    if (!customerId) {
      setError("Pick a customer.");
      return;
    }
    if (!catalogItemId) {
      setError("Pick a service.");
      return;
    }
    if (!scheduledAt) {
      setError("Pick a date and time.");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      await BookingsApi.createByStaff(tenantId, {
        customerId,
        catalogItemId,
        scheduledAt: new Date(scheduledAt).toISOString(),
        durationMinutes: durationMinutes === "" ? undefined : Number(durationMinutes),
        notes: notes || undefined,
      });
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create this booking.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card title="Book for a customer">
      {error && <Banner kind="error">{error}</Banner>}
      <div className="form-grid">
        <div className="field">
          <label htmlFor="booking-customer">Customer</label>
          <select id="booking-customer" value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
            <option value="">Select a customer…</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.displayName ?? c.phone ?? c.email ?? c.id}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="booking-service">Service</label>
          <select id="booking-service" value={catalogItemId} onChange={(e) => setCatalogItemId(e.target.value)}>
            <option value="">Select a service…</option>
            {catalog.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="booking-when">Date & time</label>
          <input id="booking-when" type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="booking-duration">Duration (minutes, optional — defaults to the service's own)</label>
          <input
            id="booking-duration"
            type="number"
            min={1}
            value={durationMinutes}
            onChange={(e) => setDurationMinutes(e.target.value === "" ? "" : Number(e.target.value))}
          />
        </div>
        <div className="field">
          <label htmlFor="booking-notes">Notes (optional)</label>
          <input id="booking-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
      </div>
      <div style={{ marginTop: "0.9rem" }}>
        <Button variant="primary" disabled={submitting} onClick={() => void handleSubmit()}>
          {submitting ? "Booking…" : "Confirm booking"}
        </Button>
      </div>
    </Card>
  );
}

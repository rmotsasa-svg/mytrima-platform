import { useEffect, useState } from "react";
import { BookingsApi, CatalogApi, CustomersApi } from "../api/resources";
import type { Booking, BookingStatus, CatalogItem, Customer } from "../api/types";
import { useAuth } from "../auth/AuthContext";
import { ApiError } from "../api/client";
import { Banner, Button, EmptyState, PageHeader, Pill, formatDateTime } from "../components/ui";

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
      <PageHeader title="Bookings" subtitle="Customer-requested appointments — customers submit these themselves, no Mytrima account needed." />
      {error && <Banner kind="error">{error}</Banner>}
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

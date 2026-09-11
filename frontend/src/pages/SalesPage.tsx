import { useEffect, useState } from "react";
import { CatalogApi, CustomersApi, SalesApi } from "../api/resources";
import type { CatalogItem, Customer, SaleTransaction } from "../api/types";
import { useAuth } from "../auth/AuthContext";
import { ApiError } from "../api/client";
import { Banner, Button, Card, EmptyState, PageHeader, formatDateTime, formatMoney } from "../components/ui";

const PAGE_SIZE = 20;

export function SalesPage() {
  const { session } = useAuth();
  const tenantId = session.status === "loggedIn" ? session.profile.tenantId : "";
  const canManage = session.status === "loggedIn" && session.profile.role !== "read_only";

  const [sales, setSales] = useState<SaleTransaction[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);

  async function loadPage(nextOffset: number) {
    if (!tenantId) return;
    setLoading(true);
    try {
      const page = await SalesApi.list(tenantId, PAGE_SIZE, nextOffset);
      setSales(page.items);
      setTotal(page.total);
      setOffset(nextOffset);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load sales.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!tenantId) return;
    void loadPage(0);
    CatalogApi.list(tenantId).then(setCatalog).catch(() => undefined);
    CustomersApi.list(tenantId).then(setCustomers).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  return (
    <div>
      <PageHeader
        title="Sales"
        subtitle={`${total} transaction${total === 1 ? "" : "s"} on record`}
        actions={
          canManage && (
            <Button variant="primary" onClick={() => setShowForm((s) => !s)}>
              {showForm ? "Cancel" : "Record a sale"}
            </Button>
          )
        }
      />

      {error && <Banner kind="error">{error}</Banner>}

      {showForm && (
        <>
          <RecordSaleForm
            tenantId={tenantId}
            catalog={catalog}
            customers={customers}
            onRecorded={() => {
              setShowForm(false);
              void loadPage(0);
            }}
          />
          <div style={{ height: "1.1rem" }} />
        </>
      )}

      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th>Occurred</th>
              <th>Source</th>
              <th>Items</th>
              <th>Subtotal</th>
              <th>Discount</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            {sales.map((sale) => (
              <tr key={sale.id}>
                <td>{formatDateTime(sale.occurredAt)}</td>
                <td>{sale.source}</td>
                <td>{sale.lineItems.reduce((n, li) => n + li.quantity, 0)}</td>
                <td className="tabular">{formatMoney(sale.subtotalAmount)}</td>
                <td className="tabular">{formatMoney(sale.discountAmount)}</td>
                <td className="tabular">
                  <strong>{formatMoney(sale.totalAmount)}</strong>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!loading && sales.length === 0 && <EmptyState>No sales recorded for this period yet.</EmptyState>}
      </div>

      {total > PAGE_SIZE && (
        <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem", marginTop: "0.85rem" }}>
          <Button variant="secondary" disabled={offset === 0 || loading} onClick={() => void loadPage(Math.max(0, offset - PAGE_SIZE))}>
            ← Newer
          </Button>
          <Button variant="secondary" disabled={offset + PAGE_SIZE >= total || loading} onClick={() => void loadPage(offset + PAGE_SIZE)}>
            Older →
          </Button>
        </div>
      )}
    </div>
  );
}

function RecordSaleForm({
  tenantId,
  catalog,
  customers,
  onRecorded,
}: {
  tenantId: string;
  catalog: CatalogItem[];
  customers: Customer[];
  onRecorded: () => void;
}) {
  const [customerId, setCustomerId] = useState("");
  const [catalogItemId, setCatalogItemId] = useState(catalog[0]?.id ?? "");
  const [quantity, setQuantity] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const selectedItem = catalog.find((c) => c.id === catalogItemId);

  async function handleSubmit() {
    if (!selectedItem) {
      setError("Add a catalog item first — Catalog page.");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      await SalesApi.record(tenantId, {
        customerId: customerId || undefined,
        lineItems: [{ catalogItemId: selectedItem.id, quantity, unitPrice: selectedItem.unitPrice }],
      });
      onRecorded();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not record this sale.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card title="Record a sale">
      {error && <Banner kind="error">{error}</Banner>}
      {catalog.length === 0 ? (
        <p style={{ color: "var(--color-ink-muted)" }}>Add at least one catalog item before recording a sale.</p>
      ) : (
        <div className="form-grid">
          <div className="field">
            <label htmlFor="sale-item">Item</label>
            <select id="sale-item" value={catalogItemId} onChange={(e) => setCatalogItemId(e.target.value)}>
              {catalog.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name} ({formatMoney(item.unitPrice)})
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="sale-qty">Quantity</label>
            <input id="sale-qty" type="number" min={1} value={quantity} onChange={(e) => setQuantity(Number(e.target.value))} />
          </div>
          <div className="field">
            <label htmlFor="sale-customer">Customer (optional)</label>
            <select id="sale-customer" value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
              <option value="">Walk-in / unspecified</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.displayName ?? c.phone ?? c.email ?? c.id}
                </option>
              ))}
            </select>
          </div>
          <Button variant="primary" disabled={submitting} onClick={() => void handleSubmit()}>
            {submitting ? "Recording…" : "Record sale"}
          </Button>
        </div>
      )}
    </Card>
  );
}

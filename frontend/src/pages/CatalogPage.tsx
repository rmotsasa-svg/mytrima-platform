import { useEffect, useState } from "react";
import { CatalogApi } from "../api/resources";
import type { CatalogItem, ItemType } from "../api/types";
import { useAuth } from "../auth/AuthContext";
import { ApiError } from "../api/client";
import { Banner, Button, Card, EmptyState, PageHeader, Pill, formatMoney } from "../components/ui";

export function CatalogPage() {
  const { session } = useAuth();
  const tenantId = session.status === "loggedIn" ? session.profile.tenantId : "";
  const canManage = session.status === "loggedIn" && session.profile.role !== "read_only";

  const [items, setItems] = useState<CatalogItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);

  async function load() {
    if (!tenantId) return;
    setLoading(true);
    try {
      setItems(await CatalogApi.list(tenantId));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load the catalog.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  async function toggleActive(item: CatalogItem) {
    try {
      await CatalogApi.update(tenantId, item.id, { isActive: !item.isActive });
      void load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not update this item.");
    }
  }

  return (
    <div>
      <PageHeader
        title="Catalog"
        subtitle={`${items.length} item${items.length === 1 ? "" : "s"}`}
        actions={
          canManage && (
            <Button variant="primary" onClick={() => setShowForm((s) => !s)}>
              {showForm ? "Cancel" : "Add item"}
            </Button>
          )
        }
      />

      {error && <Banner kind="error">{error}</Banner>}

      {showForm && (
        <>
          <NewItemForm
            tenantId={tenantId}
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
              <th>Name</th>
              <th>Type</th>
              <th>SKU</th>
              <th>Price</th>
              <th>Duration</th>
              <th>Status</th>
              {canManage && <th></th>}
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td>{item.name}</td>
                <td>{item.itemType}</td>
                <td>{item.sku ?? "—"}</td>
                <td className="tabular">{formatMoney(item.unitPrice)}</td>
                <td>{item.durationMinutes ? `${item.durationMinutes} min` : "—"}</td>
                <td>
                  <Pill tone={item.isActive ? "positive" : "neutral"}>{item.isActive ? "Active" : "Inactive"}</Pill>
                </td>
                {canManage && (
                  <td>
                    <Button variant="ghost" onClick={() => void toggleActive(item)}>
                      {item.isActive ? "Deactivate" : "Reactivate"}
                    </Button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        {!loading && items.length === 0 && <EmptyState>No catalog items yet — services and products a customer can book or buy live here.</EmptyState>}
      </div>
    </div>
  );
}

function NewItemForm({ tenantId, onCreated }: { tenantId: string; onCreated: () => void }) {
  const [name, setName] = useState("");
  const [itemType, setItemType] = useState<ItemType>("service");
  const [unitPrice, setUnitPrice] = useState(0);
  const [sku, setSku] = useState("");
  const [durationMinutes, setDurationMinutes] = useState<number | "">("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    if (!name.trim()) {
      setError("Give this item a name.");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      await CatalogApi.create(tenantId, {
        name: name.trim(),
        itemType,
        unitPrice,
        sku: sku || undefined,
        durationMinutes: itemType === "service" && durationMinutes !== "" ? Number(durationMinutes) : undefined,
      });
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not add this item.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card title="Add a catalog item">
      {error && <Banner kind="error">{error}</Banner>}
      <div className="form-grid">
        <div className="field">
          <label htmlFor="item-name">Name</label>
          <input id="item-name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="item-type">Type</label>
          <select id="item-type" value={itemType} onChange={(e) => setItemType(e.target.value as ItemType)}>
            <option value="service">Service</option>
            <option value="product">Product</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="item-price">Unit price</label>
          <input id="item-price" type="number" min={0} step="0.01" value={unitPrice} onChange={(e) => setUnitPrice(Number(e.target.value))} />
        </div>
        <div className="field">
          <label htmlFor="item-sku">SKU (optional)</label>
          <input id="item-sku" value={sku} onChange={(e) => setSku(e.target.value)} />
        </div>
        {itemType === "service" && (
          <div className="field">
            <label htmlFor="item-duration">Duration (minutes)</label>
            <input id="item-duration" type="number" min={1} value={durationMinutes} onChange={(e) => setDurationMinutes(e.target.value === "" ? "" : Number(e.target.value))} />
          </div>
        )}
        <Button variant="primary" disabled={submitting} onClick={() => void handleSubmit()}>
          {submitting ? "Adding…" : "Add item"}
        </Button>
      </div>
    </Card>
  );
}

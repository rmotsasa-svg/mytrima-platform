import { useEffect, useState } from "react";
import { CatalogApi } from "../api/resources";
import type { CatalogItem, ItemType } from "../api/types";
import { useAuth } from "../auth/AuthContext";
import { ApiError, resolveUploadUrl } from "../api/client";
import { Banner, Button, Card, EmptyState, PageHeader, Pill, formatMoney } from "../components/ui";

export function CatalogPage() {
  const { session } = useAuth();
  const tenantId = session.status === "loggedIn" ? session.profile.tenantId : "";
  const canManage = session.status === "loggedIn" && session.profile.role !== "read_only";

  const [items, setItems] = useState<CatalogItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

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

  async function uploadPhoto(itemId: string, file: File | undefined) {
    if (!file) return;
    setError(null);
    setUploadingId(itemId);
    try {
      await CatalogApi.uploadImage(tenantId, itemId, file);
      void load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not upload this photo.");
    } finally {
      setUploadingId(null);
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
              <th>Photo</th>
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
            {items.map((item) =>
              editingId === item.id ? (
                <EditItemRow
                  key={item.id}
                  tenantId={tenantId}
                  item={item}
                  onSaved={() => {
                    setEditingId(null);
                    void load();
                  }}
                  onCancel={() => setEditingId(null)}
                />
              ) : (
              <tr key={item.id}>
                <td>
                  <label
                    htmlFor={canManage ? `photo-${item.id}` : undefined}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      width: 44,
                      height: 44,
                      borderRadius: 6,
                      overflow: "hidden",
                      background: "var(--color-surface-sunken)",
                      cursor: canManage ? "pointer" : "default",
                      fontSize: "0.65rem",
                      color: "var(--color-ink-muted)",
                      textAlign: "center",
                    }}
                    title={canManage ? "Click to upload a photo" : undefined}
                  >
                    {uploadingId === item.id ? (
                      "…"
                    ) : item.imageUrl ? (
                      <img src={resolveUploadUrl(item.imageUrl)} alt={item.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    ) : (
                      "No photo"
                    )}
                  </label>
                  {canManage && (
                    <input
                      id={`photo-${item.id}`}
                      type="file"
                      accept="image/png,image/jpeg,image/webp,image/gif"
                      style={{ display: "none" }}
                      onChange={(e) => void uploadPhoto(item.id, e.target.files?.[0])}
                    />
                  )}
                </td>
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
                    <div style={{ display: "flex", gap: "0.4rem" }}>
                      <Button variant="ghost" onClick={() => setEditingId(item.id)}>
                        Edit
                      </Button>
                      <Button variant="ghost" onClick={() => void toggleActive(item)}>
                        {item.isActive ? "Deactivate" : "Reactivate"}
                      </Button>
                    </div>
                  </td>
                )}
              </tr>
              )
            )}
          </tbody>
        </table>
        {!loading && items.length === 0 && <EmptyState>No catalog items yet — services and products a customer can book or buy live here.</EmptyState>}
      </div>
    </div>
  );
}

/** Real gap closed 2026-09-14 at the tenant's own request — CatalogApi.update()
 * already existed (toggleActive above has used it since this page's first
 * version) but nothing here ever let a tenant edit an item's own name,
 * price, SKU, or duration. Same real PATCH semantics as CatalogApi.update()
 * itself: a field left unchanged in this row is sent back unchanged, so
 * there's nothing to accidentally clear. */
function EditItemRow({
  tenantId,
  item,
  onSaved,
  onCancel,
}: {
  tenantId: string;
  item: CatalogItem;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(item.name);
  const [unitPrice, setUnitPrice] = useState(item.unitPrice);
  const [sku, setSku] = useState(item.sku ?? "");
  const [durationMinutes, setDurationMinutes] = useState<number | "">(item.durationMinutes ?? "");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSave() {
    if (!name.trim()) {
      setError("Give this item a name.");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      await CatalogApi.update(tenantId, item.id, {
        name: name.trim(),
        unitPrice,
        sku: sku || undefined,
        durationMinutes: item.itemType === "service" && durationMinutes !== "" ? Number(durationMinutes) : undefined,
      });
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save this item.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <tr>
      <td colSpan={2}>
        {error && <Banner kind="error">{error}</Banner>}
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" style={{ width: "100%" }} />
      </td>
      <td>{item.itemType}</td>
      <td>
        <input value={sku} onChange={(e) => setSku(e.target.value)} placeholder="SKU" style={{ width: "6rem" }} />
      </td>
      <td>
        <input type="number" min={0} step="0.01" value={unitPrice} onChange={(e) => setUnitPrice(Number(e.target.value))} style={{ width: "6rem" }} />
      </td>
      <td>
        {item.itemType === "service" ? (
          <input
            type="number"
            min={1}
            value={durationMinutes}
            onChange={(e) => setDurationMinutes(e.target.value === "" ? "" : Number(e.target.value))}
            style={{ width: "5rem" }}
          />
        ) : (
          "—"
        )}
      </td>
      <td>
        <Pill tone={item.isActive ? "positive" : "neutral"}>{item.isActive ? "Active" : "Inactive"}</Pill>
      </td>
      <td>
        <div style={{ display: "flex", gap: "0.4rem" }}>
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

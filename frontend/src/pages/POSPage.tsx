import { Fragment, useEffect, useState } from "react";
import { CatalogApi, CustomersApi, DealsApi, PettyCashApi, SalesApi, VendorsApi } from "../api/resources";
import type { CatalogItem, Customer, Deal, PettyCashTransaction, RefundLineItemInput, SaleRefund, SaleTransaction, Vendor } from "../api/types";
import { useAuth } from "../auth/AuthContext";
import { ApiError } from "../api/client";
import { Banner, Button, Card, EmptyState, PageHeader, Pill, formatDateTime, formatMoney } from "../components/ui";

const PAGE_SIZE = 20;

/**
 * Renamed from "Sales" to "P.O.S." (Point of Sale) at the tenant's own
 * explicit request, which also asked for two real capabilities this page
 * didn't have: processing refunds/exchanges, and petty cash. Petty cash
 * itself was a real, already-working, already-tested backend module
 * (petty-cash.service.ts/vendor.service.ts) with NO frontend anywhere —
 * confirmed by grep before building this — so it's genuinely new UI here,
 * not a moved page. Refunds are a real new backend feature too (see
 * refund.service.ts's own top comment for why "exchange" is composed here
 * — a refund plus an ordinary new sale — rather than being a third backend
 * concept).
 */
type Tab = "sales" | "pettyCash";

export function POSPage() {
  const { session } = useAuth();
  const tenantId = session.status === "loggedIn" ? session.profile.tenantId : "";
  const canManage = session.status === "loggedIn" && session.profile.role !== "read_only";

  const [tab, setTab] = useState<Tab>("sales");

  const [sales, setSales] = useState<SaleTransaction[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [refundingSaleId, setRefundingSaleId] = useState<string | null>(null);

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
    DealsApi.list(tenantId).then(setDeals).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  return (
    <div>
      <PageHeader
        title="P.O.S."
        subtitle="Point of sale — process sales, refunds, exchanges, and petty cash"
        actions={
          <div style={{ display: "flex", gap: "0.4rem" }}>
            <Button variant={tab === "sales" ? "primary" : "secondary"} onClick={() => setTab("sales")}>
              Sales
            </Button>
            <Button variant={tab === "pettyCash" ? "primary" : "secondary"} onClick={() => setTab("pettyCash")}>
              Petty cash
            </Button>
          </div>
        }
      />

      {error && <Banner kind="error">{error}</Banner>}

      {tab === "sales" ? (
        <>
          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "0.85rem" }}>
            {canManage && (
              <Button variant="primary" onClick={() => setShowForm((s) => !s)}>
                {showForm ? "Cancel" : "Record a sale"}
              </Button>
            )}
          </div>

          {showForm && (
            <>
              <RecordSaleForm
                tenantId={tenantId}
                catalog={catalog}
                customers={customers}
                deals={deals}
                onRecorded={() => {
                  setShowForm(false);
                  void loadPage(0);
                }}
              />
              <div style={{ height: "1.1rem" }} />
            </>
          )}

          <p style={{ color: "var(--color-ink-muted)", fontSize: "0.85rem", margin: "0 0 0.6rem" }}>
            {total} transaction{total === 1 ? "" : "s"} on record
          </p>

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
                  {canManage && <th></th>}
                </tr>
              </thead>
              <tbody>
                {sales.map((sale) => (
                  <Fragment key={sale.id}>
                    <tr>
                      <td>{formatDateTime(sale.occurredAt)}</td>
                      <td>{sale.source}</td>
                      <td>{sale.lineItems.reduce((n, li) => n + li.quantity, 0)}</td>
                      <td className="tabular">{formatMoney(sale.subtotalAmount)}</td>
                      <td className="tabular">{formatMoney(sale.discountAmount)}</td>
                      <td className="tabular">
                        <strong>{formatMoney(sale.totalAmount)}</strong>
                      </td>
                      {canManage && (
                        <td>
                          <Button variant="ghost" onClick={() => setRefundingSaleId(refundingSaleId === sale.id ? null : sale.id)}>
                            {refundingSaleId === sale.id ? "Close" : "Refund / Exchange"}
                          </Button>
                        </td>
                      )}
                    </tr>
                    {refundingSaleId === sale.id && (
                      <tr>
                        <td colSpan={canManage ? 7 : 6} style={{ background: "var(--color-surface-sunken)" }}>
                          <RefundExchangeForm
                            tenantId={tenantId}
                            sale={sale}
                            catalog={catalog}
                            onDone={() => {
                              setRefundingSaleId(null);
                              void loadPage(offset);
                            }}
                          />
                        </td>
                      </tr>
                    )}
                  </Fragment>
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
        </>
      ) : (
        <PettyCashTab tenantId={tenantId} canManage={canManage} />
      )}
    </div>
  );
}

function RecordSaleForm({
  tenantId,
  catalog,
  customers,
  deals,
  onRecorded,
}: {
  tenantId: string;
  catalog: CatalogItem[];
  customers: Customer[];
  deals: Deal[];
  onRecorded: () => void;
}) {
  const [customerId, setCustomerId] = useState("");
  const [catalogItemId, setCatalogItemId] = useState(catalog[0]?.id ?? "");
  const [quantity, setQuantity] = useState(1);
  const [dealId, setDealId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const selectedItem = catalog.find((c) => c.id === catalogItemId);
  // Captured once when this form mounts, not read fresh on every render —
  // a real form is open for at most a few minutes, and reading Date.now()
  // directly during render is an impure call React's own rules warn
  // against (a re-render could otherwise flip which deals look "live"
  // mid-edit for no reason the user caused).
  const [now] = useState(() => Date.now());
  // Only deals that actually apply to the item currently selected, and are
  // live right now (same real Upcoming/Live/Expired logic DealsPage.tsx
  // uses) — showing an inapplicable or expired deal here would just be a
  // confusing choice with no real effect on the recorded sale.
  const applicableDeals = deals.filter((d) => {
    if (!d.catalogItemIds.includes(catalogItemId)) return false;
    const starts = d.startsAt ? new Date(d.startsAt).getTime() : undefined;
    const ends = d.endsAt ? new Date(d.endsAt).getTime() : undefined;
    if (starts && now < starts) return false;
    if (ends && now > ends) return false;
    return true;
  });

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
        dealId: dealId || undefined,
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
            <select
              id="sale-item"
              value={catalogItemId}
              onChange={(e) => {
                setCatalogItemId(e.target.value);
                setDealId("");
              }}
            >
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
          <div className="field">
            <label htmlFor="sale-deal">Apply a deal (optional)</label>
            <select id="sale-deal" value={dealId} onChange={(e) => setDealId(e.target.value)} disabled={applicableDeals.length === 0}>
              <option value="">{applicableDeals.length === 0 ? "No live deal for this item" : "No deal"}</option>
              {applicableDeals.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
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

/** One real primitive (recordRefund) covers both "refund" and "exchange":
 * exchange mode just also records an ordinary new sale for the
 * replacement item right after — see refund.service.ts's own top comment
 * for why that composition lives here, not on the backend. */
function RefundExchangeForm({
  tenantId,
  sale,
  catalog,
  onDone,
}: {
  tenantId: string;
  sale: SaleTransaction;
  catalog: CatalogItem[];
  onDone: () => void;
}) {
  const [existingRefunds, setExistingRefunds] = useState<SaleRefund[] | null>(null);
  const [refundQuantities, setRefundQuantities] = useState<Record<string, number>>({});
  const [reason, setReason] = useState("");
  const [mode, setMode] = useState<"refund" | "exchange">("refund");
  const [exchangeItemId, setExchangeItemId] = useState(catalog[0]?.id ?? "");
  const [exchangeQuantity, setExchangeQuantity] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    SalesApi.listRefunds(tenantId, sale.id)
      .then(setExistingRefunds)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load this sale's refund history."));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, sale.id]);

  function refundedSoFar(lineItemId: string): number {
    if (!existingRefunds) return 0;
    const line = sale.lineItems.find((li) => li.id === lineItemId);
    if (!line) return 0;
    const key = line.catalogItemId ?? line.description;
    return existingRefunds.reduce(
      (sum, r) => sum + r.lineItems.filter((ri) => (ri.catalogItemId ?? ri.description) === key).reduce((s, ri) => s + ri.quantity, 0),
      0
    );
  }

  async function handleSubmit() {
    const lines: RefundLineItemInput[] = sale.lineItems
      .map((li) => ({ li, qty: refundQuantities[li.id] ?? 0 }))
      .filter(({ qty }) => qty > 0)
      .map(({ li, qty }) => ({ catalogItemId: li.catalogItemId, description: li.description, quantity: qty, unitPrice: li.unitPrice }));

    if (lines.length === 0) {
      setError("Enter a quantity to refund for at least one item.");
      return;
    }
    if (mode === "exchange" && !exchangeItemId) {
      setError("Pick a replacement item for the exchange.");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      await SalesApi.recordRefund(tenantId, sale.id, lines, reason || undefined);
      if (mode === "exchange") {
        const replacement = catalog.find((c) => c.id === exchangeItemId);
        if (replacement) {
          await SalesApi.record(tenantId, {
            customerId: sale.customerId,
            lineItems: [{ catalogItemId: replacement.id, quantity: exchangeQuantity, unitPrice: replacement.unitPrice }],
          });
        }
      }
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not process this refund/exchange.");
    } finally {
      setSubmitting(false);
    }
  }

  if (existingRefunds === null) return <p style={{ margin: 0, color: "var(--color-ink-muted)" }}>Loading refund history…</p>;

  return (
    <div style={{ padding: "0.85rem 0" }}>
      {error && <Banner kind="error">{error}</Banner>}

      {existingRefunds.length > 0 && (
        <p style={{ margin: "0 0 0.6rem", fontSize: "0.82rem", color: "var(--color-ink-muted)" }}>
          {existingRefunds.length} prior refund{existingRefunds.length === 1 ? "" : "s"} on this sale, totaling{" "}
          {formatMoney(existingRefunds.reduce((s, r) => s + r.refundAmount, 0))}.
        </p>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem", marginBottom: "0.75rem" }}>
        {sale.lineItems.map((li) => {
          const alreadyRefunded = refundedSoFar(li.id);
          const remaining = li.quantity - alreadyRefunded;
          return (
            <div key={li.id} style={{ display: "flex", alignItems: "center", gap: "0.6rem", fontSize: "0.85rem" }}>
              <span style={{ flex: 1 }}>
                {li.description ?? "Catalog item"} — {li.quantity} × {formatMoney(li.unitPrice)}
                {alreadyRefunded > 0 && <span style={{ color: "var(--color-ink-muted)" }}> ({alreadyRefunded} already refunded)</span>}
              </span>
              <input
                type="number"
                min={0}
                max={remaining}
                disabled={remaining <= 0}
                value={refundQuantities[li.id] ?? 0}
                onChange={(e) => setRefundQuantities((q) => ({ ...q, [li.id]: Math.min(Number(e.target.value), remaining) }))}
                style={{ width: 70 }}
              />
              <span style={{ color: "var(--color-ink-muted)", width: 90 }}>of {remaining} left</span>
            </div>
          );
        })}
      </div>

      <div className="form-grid" style={{ marginBottom: "0.75rem" }}>
        <div className="field">
          <label htmlFor="refund-reason">Reason (optional)</label>
          <input id="refund-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Customer changed their mind" />
        </div>
        <div className="field">
          <label htmlFor="refund-mode">Type</label>
          <select id="refund-mode" value={mode} onChange={(e) => setMode(e.target.value as "refund" | "exchange")}>
            <option value="refund">Refund only — money back</option>
            <option value="exchange">Exchange — for a different item</option>
          </select>
        </div>
        {mode === "exchange" && (
          <>
            <div className="field">
              <label htmlFor="exchange-item">Replacement item</label>
              <select id="exchange-item" value={exchangeItemId} onChange={(e) => setExchangeItemId(e.target.value)}>
                {catalog.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name} ({formatMoney(item.unitPrice)})
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="exchange-qty">Replacement quantity</label>
              <input id="exchange-qty" type="number" min={1} value={exchangeQuantity} onChange={(e) => setExchangeQuantity(Number(e.target.value))} />
            </div>
          </>
        )}
      </div>

      <Button variant="primary" disabled={submitting} onClick={() => void handleSubmit()}>
        {submitting ? "Processing…" : mode === "exchange" ? "Process exchange" : "Process refund"}
      </Button>
    </div>
  );
}

function PettyCashTab({ tenantId, canManage }: { tenantId: string; canManage: boolean }) {
  const [transactions, setTransactions] = useState<PettyCashTransaction[]>([]);
  const [balance, setBalance] = useState(0);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showReplenish, setShowReplenish] = useState(false);
  const [showPayVendor, setShowPayVendor] = useState(false);

  async function load() {
    if (!tenantId) return;
    setLoading(true);
    try {
      const [ledger, v] = await Promise.all([PettyCashApi.ledger(tenantId), VendorsApi.list(tenantId)]);
      setTransactions(ledger.transactions);
      setBalance(ledger.balance);
      setVendors(v);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load petty cash.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  const vendorNameById = new Map(vendors.map((v) => [v.id, v.name]));
  const sorted = [...transactions].sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime());

  return (
    <div>
      {error && <Banner kind="error">{error}</Banner>}

      <Card title="Balance">
        <p style={{ margin: 0, fontSize: "1.6rem" }} className="tabular">
          {formatMoney(balance)}
        </p>
      </Card>

      <div style={{ height: "1.1rem" }} />

      {canManage && (
        <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1.1rem" }}>
          <Button
            variant="primary"
            onClick={() => {
              setShowReplenish((s) => !s);
              setShowPayVendor(false);
            }}
          >
            {showReplenish ? "Cancel" : "Replenish float"}
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              setShowPayVendor((s) => !s);
              setShowReplenish(false);
            }}
          >
            {showPayVendor ? "Cancel" : "Pay a vendor"}
          </Button>
        </div>
      )}

      {showReplenish && (
        <>
          <ReplenishForm tenantId={tenantId} onDone={() => { setShowReplenish(false); void load(); }} />
          <div style={{ height: "1.1rem" }} />
        </>
      )}

      {showPayVendor && (
        <>
          <PayVendorForm
            tenantId={tenantId}
            vendors={vendors}
            onVendorCreated={(v) => setVendors((vs) => [...vs, v])}
            onDone={() => { setShowPayVendor(false); void load(); }}
          />
          <div style={{ height: "1.1rem" }} />
        </>
      )}

      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Type</th>
              <th>Vendor</th>
              <th>Description</th>
              <th>Amount</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((t) => (
              <tr key={t.id}>
                <td>{formatDateTime(t.occurredAt)}</td>
                <td>
                  <Pill tone={t.type === "replenishment" ? "positive" : "attention"}>{t.type === "replenishment" ? "Replenishment" : "Vendor payment"}</Pill>
                </td>
                <td>{t.vendorId ? vendorNameById.get(t.vendorId) ?? "—" : "—"}</td>
                <td>{t.description ?? "—"}</td>
                <td className="tabular">
                  {t.type === "replenishment" ? "+" : "−"}
                  {formatMoney(t.amount)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!loading && sorted.length === 0 && <EmptyState>No petty cash activity yet.</EmptyState>}
      </div>
    </div>
  );
}

function ReplenishForm({ tenantId, onDone }: { tenantId: string; onDone: () => void }) {
  const [amount, setAmount] = useState(0);
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    if (amount <= 0) {
      setError("Amount must be a positive number.");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      await PettyCashApi.replenish(tenantId, amount, description || undefined);
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not replenish the float.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card title="Replenish float">
      {error && <Banner kind="error">{error}</Banner>}
      <div className="form-grid">
        <div className="field">
          <label htmlFor="replenish-amount">Amount</label>
          <input id="replenish-amount" type="number" min={0.01} step="0.01" value={amount} onChange={(e) => setAmount(Number(e.target.value))} />
        </div>
        <div className="field">
          <label htmlFor="replenish-desc">Description (optional)</label>
          <input id="replenish-desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. Weekly float top-up" />
        </div>
        <Button variant="primary" disabled={submitting} onClick={() => void handleSubmit()}>
          {submitting ? "Recording…" : "Replenish"}
        </Button>
      </div>
    </Card>
  );
}

function PayVendorForm({
  tenantId,
  vendors,
  onVendorCreated,
  onDone,
}: {
  tenantId: string;
  vendors: Vendor[];
  onVendorCreated: (vendor: Vendor) => void;
  onDone: () => void;
}) {
  const [vendorId, setVendorId] = useState(vendors[0]?.id ?? "");
  const [newVendorName, setNewVendorName] = useState("");
  const [amount, setAmount] = useState(0);
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    if (amount <= 0) {
      setError("Amount must be a positive number.");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      let realVendorId = vendorId;
      if (!realVendorId && newVendorName.trim()) {
        const vendor = await VendorsApi.create(tenantId, newVendorName.trim());
        onVendorCreated(vendor);
        realVendorId = vendor.id;
      }
      if (!realVendorId) {
        setError("Pick an existing vendor or name a new one.");
        setSubmitting(false);
        return;
      }
      await PettyCashApi.payVendor(tenantId, realVendorId, amount, description || undefined);
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not record this payment.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card title="Pay a vendor">
      {error && <Banner kind="error">{error}</Banner>}
      <div className="form-grid">
        <div className="field">
          <label htmlFor="pv-vendor">Vendor</label>
          <select id="pv-vendor" value={vendorId} onChange={(e) => setVendorId(e.target.value)}>
            <option value="">New vendor…</option>
            {vendors.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
        </div>
        {!vendorId && (
          <div className="field">
            <label htmlFor="pv-new-vendor">New vendor name</label>
            <input id="pv-new-vendor" value={newVendorName} onChange={(e) => setNewVendorName(e.target.value)} />
          </div>
        )}
        <div className="field">
          <label htmlFor="pv-amount">Amount</label>
          <input id="pv-amount" type="number" min={0.01} step="0.01" value={amount} onChange={(e) => setAmount(Number(e.target.value))} />
        </div>
        <div className="field">
          <label htmlFor="pv-desc">Description (optional)</label>
          <input id="pv-desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. Restocked shampoo" />
        </div>
        <Button variant="primary" disabled={submitting} onClick={() => void handleSubmit()}>
          {submitting ? "Recording…" : "Pay vendor"}
        </Button>
      </div>
    </Card>
  );
}

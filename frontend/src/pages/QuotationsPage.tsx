import { Fragment, useEffect, useState } from "react";
import { QuotationsApi, CustomersApi, TenantApi } from "../api/resources";
import type { Customer, Quotation, QuotationLineItemInput, QuotationSendChannel, QuotationSendResult } from "../api/types";
import { useAuth } from "../auth/AuthContext";
import { ApiError } from "../api/client";
import { Banner, Button, Card, EmptyState, PageHeader, Pill, formatDateTime, formatMoney } from "../components/ui";

const EMPTY_LINE: QuotationLineItemInput = { description: "", quantity: 1, unitPrice: 0 };

function customerLabel(c: Customer): string {
  return c.displayName ?? c.phone ?? c.email ?? "Unnamed customer";
}

/** "Let's add a quotation module... tenants must be able to send through
 * email or whatsapp" — the tenant's own explicit request (2026-09-16). */
export function QuotationsPage() {
  const { session } = useAuth();
  const tenantId = session.status === "loggedIn" ? session.profile.tenantId : "";
  const canManage = session.status === "loggedIn" && session.profile.role !== "read_only";

  const [quotations, setQuotations] = useState<Quotation[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);

  async function load() {
    if (!tenantId) return;
    setLoading(true);
    try {
      const [q, c] = await Promise.all([QuotationsApi.list(tenantId), CustomersApi.list(tenantId)]);
      setQuotations(q);
      setCustomers(c);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load quotations.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  function customerNameFor(id?: string): string {
    if (!id) return "—";
    const found = customers.find((c) => c.id === id);
    return found ? customerLabel(found) : "—";
  }

  return (
    <div>
      <PageHeader
        title="Quotations"
        subtitle={`${quotations.length} shown`}
        actions={
          canManage && (
            <Button variant="primary" onClick={() => setShowForm((s) => !s)}>
              {showForm ? "Cancel" : "New quotation"}
            </Button>
          )
        }
      />

      {error && <Banner kind="error">{error}</Banner>}

      {showForm && (
        <>
          <NewQuotationForm
            tenantId={tenantId}
            customers={customers}
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
              <th>Quote #</th>
              <th>Customer</th>
              <th>Total</th>
              <th>Status</th>
              <th>Created</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {quotations.map((q) => (
              <Fragment key={q.id}>
                <tr>
                  <td className="tabular">{q.quoteNumber}</td>
                  <td>{customerNameFor(q.customerId)}</td>
                  <td className="tabular">{formatMoney(q.totalAmount)}</td>
                  <td>
                    <Pill tone={q.status === "sent" ? "positive" : "neutral"}>{q.status}</Pill>
                  </td>
                  <td>{formatDateTime(q.createdAt)}</td>
                  <td>
                    <div style={{ display: "flex", gap: "0.35rem" }}>
                      <Button variant="ghost" onClick={() => setPreviewId((id) => (id === q.id ? null : q.id))}>
                        {previewId === q.id ? "Hide preview" : "Preview"}
                      </Button>
                      {canManage && (
                        <Button variant="ghost" onClick={() => setSendingId((id) => (id === q.id ? null : q.id))}>
                          {sendingId === q.id ? "Cancel" : "Send"}
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
                {previewId === q.id && (
                  <tr>
                    <td colSpan={6} style={{ background: "var(--color-surface-sunken)" }}>
                      <QuotationPreviewPanel quotation={q} customer={customers.find((c) => c.id === q.customerId)} />
                    </td>
                  </tr>
                )}
                {sendingId === q.id && (
                  <tr>
                    <td colSpan={6} style={{ background: "var(--color-surface-sunken)" }}>
                      <SendQuotationPanel
                        tenantId={tenantId}
                        quotation={q}
                        customer={customers.find((c) => c.id === q.customerId)}
                        onSent={() => {
                          setSendingId(null);
                          void load();
                        }}
                        onClose={() => setSendingId(null)}
                      />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
        {!loading && quotations.length === 0 && <EmptyState>No quotations yet.</EmptyState>}
      </div>
    </div>
  );
}

function NewQuotationForm({ tenantId, customers, onCreated }: { tenantId: string; customers: Customer[]; onCreated: () => void }) {
  const [customerId, setCustomerId] = useState("");
  const [customerAddress, setCustomerAddress] = useState("");
  const [lineItems, setLineItems] = useState<QuotationLineItemInput[]>([{ ...EMPTY_LINE }]);
  const [discountAmount, setDiscountAmount] = useState(0);
  const [notes, setNotes] = useState("");
  const [validUntil, setValidUntil] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const subtotal = lineItems.reduce((sum, li) => sum + li.quantity * li.unitPrice, 0);
  const total = Math.max(0, subtotal - discountAmount);

  function updateLine(index: number, patch: Partial<QuotationLineItemInput>) {
    setLineItems((items) => items.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  }

  function removeLine(index: number) {
    setLineItems((items) => items.filter((_, i) => i !== index));
  }

  async function handleSubmit() {
    setError(null);
    setSubmitting(true);
    try {
      await QuotationsApi.create(tenantId, {
        customerId: customerId || undefined,
        lineItems: lineItems.filter((li) => li.description?.trim() || li.catalogItemId),
        discountAmount: discountAmount || undefined,
        notes: notes || undefined,
        customerAddress: customerAddress || undefined,
        validUntil: validUntil ? new Date(validUntil).toISOString() : undefined,
      });
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create this quotation.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card title="New quotation">
      {error && <Banner kind="error">{error}</Banner>}
      <div className="form-grid" style={{ marginBottom: "0.9rem" }}>
        <div className="field">
          <label htmlFor="quo-customer">Customer (optional)</label>
          <select id="quo-customer" value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
            <option value="">— No customer on file —</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {customerLabel(c)}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="quo-valid-until">Valid until</label>
          <input id="quo-valid-until" type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
        </div>
        <div className="field" style={{ gridColumn: "1 / -1" }}>
          <label htmlFor="quo-customer-address">Customer address</label>
          <input
            id="quo-customer-address"
            value={customerAddress}
            onChange={(e) => setCustomerAddress(e.target.value)}
            placeholder="Street, town, postal code"
          />
        </div>
      </div>

      <p style={{ fontWeight: 600, fontSize: "0.85rem", margin: "0 0 0.5rem" }}>Line items</p>
      <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
        {lineItems.map((item, i) => (
          <div key={i} style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
            <span className="tabular" style={{ width: "1.4rem", fontSize: "0.85rem", color: "var(--color-ink-muted)" }}>
              {i + 1}.
            </span>
            <input
              value={item.description ?? ""}
              onChange={(e) => updateLine(i, { description: e.target.value })}
              placeholder="Description"
              style={{ flex: "2 1 12rem" }}
            />
            <input
              type="number"
              min={0.01}
              step="0.01"
              value={item.quantity}
              onChange={(e) => updateLine(i, { quantity: Number(e.target.value) })}
              placeholder="Qty"
              style={{ width: "5rem" }}
            />
            <input
              type="number"
              min={0}
              step="0.01"
              value={item.unitPrice}
              onChange={(e) => updateLine(i, { unitPrice: Number(e.target.value) })}
              placeholder="Unit price"
              style={{ width: "7rem" }}
            />
            <span className="tabular" style={{ width: "6rem", fontSize: "0.85rem", color: "var(--color-ink-muted)" }}>
              {formatMoney(item.quantity * item.unitPrice)}
            </span>
            <Button variant="ghost" disabled={lineItems.length === 1} onClick={() => removeLine(i)}>
              Remove
            </Button>
          </div>
        ))}
        <div>
          <Button variant="secondary" onClick={() => setLineItems((items) => [...items, { ...EMPTY_LINE }])}>
            Add line
          </Button>
        </div>
      </div>

      <div className="form-grid" style={{ marginTop: "0.9rem" }}>
        <div className="field">
          <label htmlFor="quo-discount">Discount amount</label>
          <input id="quo-discount" type="number" min={0} step="0.01" value={discountAmount} onChange={(e) => setDiscountAmount(Number(e.target.value))} />
        </div>
        <div className="field">
          <label htmlFor="quo-notes">Notes</label>
          <input id="quo-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
      </div>

      <p style={{ margin: "0.9rem 0 0", fontSize: "0.9rem" }}>
        Subtotal: <span className="tabular">{formatMoney(subtotal)}</span> · Total:{" "}
        <strong className="tabular">{formatMoney(total)}</strong>
      </p>

      <div style={{ marginTop: "0.9rem" }}>
        <Button variant="primary" disabled={submitting} onClick={() => void handleSubmit()}>
          {submitting ? "Creating…" : "Create quotation"}
        </Button>
      </div>
    </Card>
  );
}

/** "Have preview" — the tenant's own explicit request (2026-09-16). A
 * real, document-styled rendering of exactly what gets sent — the same
 * real fields QuotationService.buildQuotationText() uses server-side for
 * the actual email/WhatsApp body, laid out here as a proper line-item
 * table (with real item numbers, per the same request) rather than plain
 * text, so a tenant can see precisely what a customer will receive
 * before sending it. */
function QuotationPreviewPanel({ quotation, customer }: { quotation: Quotation; customer?: Customer }) {
  const [businessName, setBusinessName] = useState<string | null>(null);

  useEffect(() => {
    TenantApi.getMe()
      .then((t) => setBusinessName(t.name))
      .catch(() => {});
  }, []);

  return (
    <div style={{ padding: "0.9rem 0" }}>
      <div className="card" style={{ maxWidth: 640, background: "var(--color-surface)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "0.9rem" }}>
          <div>
            <p style={{ margin: 0, fontWeight: 700, fontSize: "1.05rem" }}>{businessName ?? "Your business"}</p>
            <p style={{ margin: "0.15rem 0 0", fontSize: "0.85rem", color: "var(--color-ink-muted)" }}>Quotation</p>
          </div>
          <div style={{ textAlign: "right" }}>
            <p className="tabular" style={{ margin: 0, fontWeight: 700 }}>
              {quotation.quoteNumber}
            </p>
            <Pill tone={quotation.status === "sent" ? "positive" : "neutral"}>{quotation.status}</Pill>
          </div>
        </div>

        <div style={{ marginBottom: "0.9rem" }}>
          <p style={{ margin: 0, fontSize: "0.78rem", textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--color-ink-muted)" }}>Bill to</p>
          <p style={{ margin: "0.15rem 0 0", fontWeight: 600 }}>{customer ? customerLabel(customer) : "No customer on file"}</p>
          {quotation.customerAddress && (
            <p style={{ margin: "0.1rem 0 0", fontSize: "0.85rem", color: "var(--color-ink-muted)", whiteSpace: "pre-line" }}>{quotation.customerAddress}</p>
          )}
        </div>

        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th style={{ width: "2.5rem" }}>#</th>
                <th>Description</th>
                <th>Qty</th>
                <th>Unit price</th>
                <th>Line total</th>
              </tr>
            </thead>
            <tbody>
              {quotation.lineItems.map((item, i) => (
                <tr key={item.id}>
                  <td className="tabular">{i + 1}</td>
                  <td>{item.description ?? "Item"}</td>
                  <td className="tabular">{item.quantity}</td>
                  <td className="tabular">{formatMoney(item.unitPrice)}</td>
                  <td className="tabular">{formatMoney(item.quantity * item.unitPrice)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "0.2rem", marginTop: "0.9rem", fontSize: "0.9rem" }}>
          <p style={{ margin: 0 }}>
            Subtotal: <span className="tabular">{formatMoney(quotation.subtotalAmount)}</span>
          </p>
          {quotation.discountAmount > 0 && (
            <p style={{ margin: 0 }}>
              Discount: <span className="tabular">-{formatMoney(quotation.discountAmount)}</span>
            </p>
          )}
          <p style={{ margin: 0, fontWeight: 700 }}>
            Total: <span className="tabular">{formatMoney(quotation.totalAmount)}</span>
          </p>
        </div>

        {quotation.validUntil && (
          <p style={{ marginTop: "0.9rem", fontSize: "0.85rem", color: "var(--color-ink-muted)" }}>
            Valid until {new Date(quotation.validUntil).toLocaleDateString()}
          </p>
        )}
        {quotation.notes && <p style={{ marginTop: "0.6rem", fontSize: "0.85rem", whiteSpace: "pre-line" }}>{quotation.notes}</p>}
      </div>
    </div>
  );
}

const SEND_CHANNELS: QuotationSendChannel[] = ["email", "whatsapp"];

function SendQuotationPanel({
  tenantId,
  quotation,
  customer,
  onSent,
  onClose,
}: {
  tenantId: string;
  quotation: Quotation;
  customer?: Customer;
  onSent: () => void;
  onClose: () => void;
}) {
  const [email, setEmail] = useState(!!customer?.email);
  const [whatsapp, setWhatsapp] = useState(!!customer?.phone);
  const [recipientEmail, setRecipientEmail] = useState(customer?.email ?? "");
  const [recipientPhone, setRecipientPhone] = useState(customer?.phone ?? "");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<QuotationSendResult | null>(null);

  async function handleSend() {
    const channels: QuotationSendChannel[] = SEND_CHANNELS.filter((c) => (c === "email" ? email : whatsapp));
    if (channels.length === 0) {
      setError("Pick at least one channel.");
      return;
    }
    setError(null);
    setSending(true);
    try {
      const res = await QuotationsApi.send(tenantId, quotation.id, channels, recipientEmail || undefined, recipientPhone || undefined);
      setResult(res);
      if (res.results.some((r) => r.status === "sent")) onSent();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not send this quotation.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div style={{ padding: "0.75rem 0" }}>
      {error && <Banner kind="error">{error}</Banner>}
      {result ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
          {result.results.map((r) => (
            <div key={r.channel} style={{ display: "flex", gap: "0.5rem", alignItems: "center", fontSize: "0.85rem" }}>
              <Pill tone={r.status === "sent" ? "positive" : r.status === "skipped" ? "neutral" : "critical"}>
                {r.channel}: {r.status}
              </Pill>
              {r.reason && <span style={{ color: "var(--color-ink-muted)" }}>{r.reason}</span>}
            </div>
          ))}
          <div>
            <Button variant="ghost" onClick={onClose}>
              Close
            </Button>
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
          <div style={{ display: "flex", gap: "1rem", alignItems: "center", flexWrap: "wrap" }}>
            <label style={{ display: "flex", gap: "0.35rem", alignItems: "center", fontSize: "0.85rem" }}>
              <input type="checkbox" checked={email} onChange={(e) => setEmail(e.target.checked)} />
              Email
            </label>
            <label style={{ display: "flex", gap: "0.35rem", alignItems: "center", fontSize: "0.85rem" }}>
              <input type="checkbox" checked={whatsapp} onChange={(e) => setWhatsapp(e.target.checked)} />
              WhatsApp
            </label>
          </div>
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            <input
              value={recipientEmail}
              onChange={(e) => setRecipientEmail(e.target.value)}
              placeholder="Recipient email"
              type="email"
              style={{ width: "13rem" }}
            />
            <input value={recipientPhone} onChange={(e) => setRecipientPhone(e.target.value)} placeholder="Recipient phone (+266...)" style={{ width: "11rem" }} />
          </div>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <Button variant="primary" disabled={sending} onClick={() => void handleSend()}>
              {sending ? "Sending…" : "Send quotation"}
            </Button>
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

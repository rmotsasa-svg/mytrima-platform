import { useEffect, useState } from "react";
import { CatalogApi, DealsApi } from "../api/resources";
import type { CatalogItem, Deal, DiscountType } from "../api/types";
import { useAuth } from "../auth/AuthContext";
import { ApiError } from "../api/client";
import { Banner, Button, Card, EmptyState, PageHeader, Pill, formatMoney } from "../components/ui";

/**
 * REAL GAP found live-testing the whole platform end to end (2026-09-12):
 * the backend's DealsModule (deal.service.ts) was fully built and already
 * applying real discounts to real sales (SaleService.recordSale() has
 * called into it since Master Plan Addendum v1.3) — but nothing in this
 * SPA ever let a tenant create, see, or "monitor" a deal at all. Closing
 * that here: list + create, following CatalogPage.tsx's own pattern.
 *
 * Honest limitation, not hidden: DealsController has no update/deactivate
 * route today — a deal's `isActive` is always true from the moment it's
 * created, and there's no usage/redemption count anywhere (no endpoint
 * aggregates "how many sales used this deal"). "Monitor" here means what's
 * actually real right now: each deal's live status computed from its own
 * start/end dates (Upcoming / Live / Expired), not a fabricated usage
 * metric the backend doesn't track.
 */
type DealPhase = "upcoming" | "live" | "expired" | "ongoing";

function dealPhase(deal: Deal): DealPhase {
  const now = Date.now();
  const starts = deal.startsAt ? new Date(deal.startsAt).getTime() : undefined;
  const ends = deal.endsAt ? new Date(deal.endsAt).getTime() : undefined;
  if (starts && now < starts) return "upcoming";
  if (ends && now > ends) return "expired";
  if (!starts && !ends) return "ongoing";
  return "live";
}

const PHASE_LABEL: Record<DealPhase, string> = { upcoming: "Upcoming", live: "Live", expired: "Expired", ongoing: "Ongoing" };
const PHASE_TONE: Record<DealPhase, "positive" | "attention" | "critical" | "neutral" | "gold"> = {
  upcoming: "gold",
  live: "positive",
  ongoing: "positive",
  expired: "neutral",
};

function describeDiscount(deal: Deal): string {
  if (deal.discountType === "percentage_off") return `${deal.percentageOff}% off`;
  if (deal.discountType === "buy_x_get_y_free") return `Buy ${deal.buyQuantity}, get ${deal.freeQuantity} free`;
  return `${formatMoney(deal.fixedAmountOff)} off`;
}

export function DealsPage() {
  const { session } = useAuth();
  const tenantId = session.status === "loggedIn" ? session.profile.tenantId : "";
  const canManage = session.status === "loggedIn" && session.profile.role !== "read_only";

  const [deals, setDeals] = useState<Deal[]>([]);
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);

  async function load() {
    if (!tenantId) return;
    setLoading(true);
    try {
      const [d, c] = await Promise.all([DealsApi.list(tenantId), CatalogApi.list(tenantId)]);
      setDeals(d);
      setCatalog(c);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load deals.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  const catalogNameById = new Map(catalog.map((c) => [c.id, c.name]));
  const sorted = [...deals].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  return (
    <div>
      <PageHeader
        title="Deals & promotions"
        subtitle={`${deals.length} deal${deals.length === 1 ? "" : "s"} — applied automatically when a matching item is sold`}
        actions={
          canManage && (
            <Button variant="primary" onClick={() => setShowForm((s) => !s)}>
              {showForm ? "Cancel" : "Create a deal"}
            </Button>
          )
        }
      />

      {error && <Banner kind="error">{error}</Banner>}

      {showForm && (
        <>
          <NewDealForm
            tenantId={tenantId}
            catalog={catalog}
            onCreated={() => {
              setShowForm(false);
              void load();
            }}
          />
          <div style={{ height: "1.1rem" }} />
        </>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
        {sorted.map((deal) => {
          const phase = dealPhase(deal);
          return (
            <div className="card" key={deal.id}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "0.75rem", flexWrap: "wrap" }}>
                <div>
                  <strong>{deal.name}</strong>
                  <p style={{ margin: "0.25rem 0 0", fontSize: "0.85rem", color: "var(--color-ink-muted)" }}>
                    {describeDiscount(deal)} on {deal.catalogItemIds.map((id) => catalogNameById.get(id) ?? "Deleted item").join(", ")}
                  </p>
                </div>
                <Pill tone={PHASE_TONE[phase]}>{PHASE_LABEL[phase]}</Pill>
              </div>
              <p style={{ margin: "0.6rem 0 0", fontSize: "0.78rem", color: "var(--color-ink-muted)" }}>
                {deal.startsAt || deal.endsAt
                  ? `${deal.startsAt ? new Date(deal.startsAt).toLocaleDateString() : "No start date"} – ${deal.endsAt ? new Date(deal.endsAt).toLocaleDateString() : "No end date"}`
                  : "Runs indefinitely"}
              </p>
            </div>
          );
        })}
        {!loading && sorted.length === 0 && (
          <div className="card">
            <EmptyState>No deals yet — create one and it's applied automatically the next time a matching item is sold.</EmptyState>
          </div>
        )}
      </div>
    </div>
  );
}

function NewDealForm({ tenantId, catalog, onCreated }: { tenantId: string; catalog: CatalogItem[]; onCreated: () => void }) {
  const [name, setName] = useState("");
  const [discountType, setDiscountType] = useState<DiscountType>("percentage_off");
  const [percentageOff, setPercentageOff] = useState(10);
  const [buyQuantity, setBuyQuantity] = useState(2);
  const [freeQuantity, setFreeQuantity] = useState(1);
  const [fixedAmountOff, setFixedAmountOff] = useState(0);
  const [catalogItemIds, setCatalogItemIds] = useState<string[]>([]);
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function toggleItem(id: string) {
    setCatalogItemIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
  }

  async function handleSubmit() {
    if (!name.trim()) {
      setError("Give this deal a name.");
      return;
    }
    if (catalogItemIds.length === 0) {
      setError("Pick at least one product or service this deal applies to.");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      await DealsApi.create(tenantId, {
        name: name.trim(),
        discountType,
        catalogItemIds,
        percentageOff: discountType === "percentage_off" ? percentageOff : undefined,
        buyQuantity: discountType === "buy_x_get_y_free" ? buyQuantity : undefined,
        freeQuantity: discountType === "buy_x_get_y_free" ? freeQuantity : undefined,
        fixedAmountOff: discountType === "fixed_amount_off" ? fixedAmountOff : undefined,
        startsAt: startsAt ? new Date(startsAt).toISOString() : undefined,
        endsAt: endsAt ? new Date(`${endsAt}T23:59:59.999Z`).toISOString() : undefined,
      });
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create this deal.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card title="Create a deal">
      {error && <Banner kind="error">{error}</Banner>}
      <div className="form-grid">
        <div className="field">
          <label htmlFor="deal-name">Name</label>
          <input id="deal-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Spring Haircut Special" />
        </div>
        <div className="field">
          <label htmlFor="deal-type">Discount type</label>
          <select id="deal-type" value={discountType} onChange={(e) => setDiscountType(e.target.value as DiscountType)}>
            <option value="percentage_off">Percentage off</option>
            <option value="buy_x_get_y_free">Buy X get Y free</option>
            <option value="fixed_amount_off">Fixed amount off</option>
          </select>
        </div>
        {discountType === "percentage_off" && (
          <div className="field">
            <label htmlFor="deal-pct">Percentage off</label>
            <input id="deal-pct" type="number" min={1} max={100} value={percentageOff} onChange={(e) => setPercentageOff(Number(e.target.value))} />
          </div>
        )}
        {discountType === "buy_x_get_y_free" && (
          <>
            <div className="field">
              <label htmlFor="deal-buy">Buy quantity</label>
              <input id="deal-buy" type="number" min={1} value={buyQuantity} onChange={(e) => setBuyQuantity(Number(e.target.value))} />
            </div>
            <div className="field">
              <label htmlFor="deal-free">Free quantity</label>
              <input id="deal-free" type="number" min={1} value={freeQuantity} onChange={(e) => setFreeQuantity(Number(e.target.value))} />
            </div>
          </>
        )}
        {discountType === "fixed_amount_off" && (
          <div className="field">
            <label htmlFor="deal-fixed">Amount off</label>
            <input id="deal-fixed" type="number" min={0} step="0.01" value={fixedAmountOff} onChange={(e) => setFixedAmountOff(Number(e.target.value))} />
          </div>
        )}
        <div className="field">
          <label htmlFor="deal-starts">Starts (optional)</label>
          <input id="deal-starts" type="date" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="deal-ends">Ends (optional)</label>
          <input id="deal-ends" type="date" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
        </div>
      </div>

      <div style={{ marginTop: "0.9rem" }}>
        <p style={{ margin: "0 0 0.5rem", fontSize: "0.85rem", fontWeight: 600 }}>Applies to</p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
          {catalog.map((item) => (
            <label
              key={item.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.35rem",
                border: "1px solid var(--color-border)",
                borderRadius: 7,
                padding: "0.35rem 0.6rem",
                fontSize: "0.85rem",
                background: catalogItemIds.includes(item.id) ? "var(--color-mint-soft)" : "transparent",
                cursor: "pointer",
              }}
            >
              <input type="checkbox" checked={catalogItemIds.includes(item.id)} onChange={() => toggleItem(item.id)} />
              {item.name}
            </label>
          ))}
          {catalog.length === 0 && <span style={{ color: "var(--color-ink-muted)", fontSize: "0.85rem" }}>Add a catalog item first.</span>}
        </div>
      </div>

      <div style={{ marginTop: "0.9rem" }}>
        <Button variant="primary" disabled={submitting} onClick={() => void handleSubmit()}>
          {submitting ? "Creating…" : "Create deal"}
        </Button>
      </div>
    </Card>
  );
}

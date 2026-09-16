import { Inject, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { QUOTATION_STORE } from "./quotation.tokens";

/**
 * "Let's add a quotation module" — the tenant's own explicit request
 * (2026-09-16). A quotation is a real, editable draft document (line
 * items, a subtotal/discount/total computed the same way Sale does) that
 * a tenant can send to a customer over email or WhatsApp — see
 * QuotationController.send() for exactly how, and this file's own
 * buildQuotationText() for the real, non-fabricated content that goes
 * into that send.
 *
 * Deliberately minimal status model — "draft" until sent, "sent" once at
 * least one channel has genuinely gone out. No accept/decline/expire
 * workflow: no product spec asks for one yet, same "don't build a
 * feature nothing has asked for" discipline as rbac.ts's own comment; a
 * real status-transition model is the thing to add if/when a tenant asks
 * to track won/lost quotes.
 */

export interface QuotationLineItemInput {
  catalogItemId?: string;
  description?: string;
  quantity: number;
  unitPrice: number;
}

export interface QuotationLineItem extends QuotationLineItemInput {
  id: string;
}

export type QuotationStatus = "draft" | "sent";

export interface Quotation {
  id: string;
  tenantId: string;
  /** "QUO-0001" — a short, human-readable number, same real-badge-number
   * pattern and same disclosed non-concurrency-safe limitation as
   * AuthService's own staffIdNumber (formatStaffIdNumber()) — see
   * formatQuoteNumber() below. Never shown as the raw uuid `id`. */
  quoteNumber: string;
  customerId?: string;
  lineItems: QuotationLineItem[];
  subtotalAmount: number;
  /** A flat amount off the subtotal — simpler than Deal's own
   * percentage/buy-x-get-y/fixed model, deliberately: a quotation is a
   * one-off negotiated document, not a standing promotional rule, so it
   * doesn't need Deal's reusable discount-type machinery. */
  discountAmount: number;
  totalAmount: number;
  notes?: string;
  /** Added 2026-09-16 at the tenant's own explicit request ("have customer
   * address") — a real, free-text address printed/sent on this specific
   * quotation. Deliberately NOT auto-copied from Customer.location (that
   * field's own comment already documents it as "a town/area name, not a
   * structured address") — a tenant types the real address here, once per
   * quotation, the same way any other real quoting/invoicing document
   * captures a billing address at the time it's issued rather than always
   * trusting whatever a customer record says today. */
  customerAddress?: string;
  validUntil?: Date;
  status: QuotationStatus;
  createdByUserId?: string;
  createdAt: Date;
  sentAt?: Date;
  /** P2.2 of "ACTION PROPOSED ADDITIONS IN PRIORITY ORDER" — set once by
   * QuotationController.convertToSale(), never by create()/update(), and
   * never cleared once set. Deliberately NOT a QuotationStatus value:
   * "converted" is a separate fact layered on top of draft/sent, not a
   * third state in that lifecycle — see convertToSale()'s own comment on
   * why only a "sent" quotation is eligible. */
  convertedToSaleId?: string;
}

export class InvalidQuotationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidQuotationError";
  }
}

export class QuotationNotFoundError extends Error {
  constructor(id: string) {
    super(`No quotation found with id "${id}"`);
    this.name = "QuotationNotFoundError";
  }
}

export interface QuotationStore {
  save(quotation: Quotation): Promise<void>;
  findAllForTenant(tenantId: string): Promise<Quotation[]>;
  findById(tenantId: string, id: string): Promise<Quotation | null>;
}

export interface CreateQuotationInput {
  customerId?: string;
  lineItems: QuotationLineItemInput[];
  discountAmount?: number;
  notes?: string;
  customerAddress?: string;
  validUntil?: Date;
}

/** Real PATCH semantics, same discipline as CustomerService.update()'s own
 * comment. `lineItems`, when given, fully replaces the existing set —
 * same "the caller sends the complete resulting list" convention as
 * Deal.catalogItemIds, since a partial line-item patch (add just one?
 * remove just one by index?) has no unambiguous real-world meaning the
 * way a single scalar field's PATCH does. `null` (not `undefined`) on
 * validUntil is the explicit "clear this date" signal, matching
 * Deal.startsAt/endsAt's own convention. */
export interface UpdateQuotationInput {
  customerId?: string | null;
  lineItems?: QuotationLineItemInput[];
  discountAmount?: number;
  notes?: string;
  customerAddress?: string;
  validUntil?: Date | null;
}

function validateLineItems(lineItems: QuotationLineItemInput[]): void {
  if (lineItems.length === 0) throw new InvalidQuotationError("a quotation needs at least one line item");
  for (const item of lineItems) {
    if (!item.catalogItemId && !item.description?.trim()) {
      throw new InvalidQuotationError("each line item needs a catalogItemId or a description");
    }
    if (!Number.isFinite(item.quantity) || item.quantity <= 0) throw new InvalidQuotationError("quantity must be a positive number");
    if (!Number.isFinite(item.unitPrice) || item.unitPrice < 0) throw new InvalidQuotationError("unitPrice must be a non-negative number");
  }
}

function computeAmounts(lineItems: QuotationLineItemInput[], discountAmount: number): { subtotalAmount: number; totalAmount: number } {
  const subtotalAmount = Math.round(lineItems.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0) * 100) / 100;
  if (discountAmount < 0) throw new InvalidQuotationError("discountAmount must not be negative");
  if (discountAmount > subtotalAmount) throw new InvalidQuotationError("discountAmount must not exceed the subtotal");
  const totalAmount = Math.round((subtotalAmount - discountAmount) * 100) / 100;
  return { subtotalAmount, totalAmount };
}

/**
 * "Quotation→Sale conversion" — P2.2 of "ACTION PROPOSED ADDITIONS IN
 * PRIORITY ORDER". A quotation is only eligible once it's genuinely been
 * sent (a draft has no "the customer accepted this" signal behind it) and
 * only once — converting twice would silently double-record the sale.
 * Pure, exported standalone so it's unit-testable without a controller,
 * same discipline as isLeadStale() (crm-stale-lead-check.service.ts). The
 * real controller (QuotationController.convertToSale()) is the only
 * caller.
 */
export function isConvertibleToSale(quotation: Pick<Quotation, "status" | "convertedToSaleId">): boolean {
  return quotation.status === "sent" && !quotation.convertedToSaleId;
}

/**
 * Each line item's unitPrice is prorated by the quotation's own
 * subtotal/total ratio so the recorded sale's real total matches the
 * quotation's negotiated total exactly — Sale has no separate flat-
 * discount concept of its own (see RecordSaleInput's own comment in
 * sale.service.ts), and a synthetic negative line item would violate
 * SaleLineItemInput's own non-negative unitPrice rule. Pure, exported
 * standalone for the same reason as isConvertibleToSale() above.
 */
export function proratedSaleLineItems(
  quotation: Pick<Quotation, "lineItems" | "subtotalAmount" | "totalAmount">
): { catalogItemId?: string; description?: string; quantity: number; unitPrice: number }[] {
  const discountRatio = quotation.subtotalAmount > 0 ? quotation.totalAmount / quotation.subtotalAmount : 1;
  return quotation.lineItems.map((item) => ({
    catalogItemId: item.catalogItemId,
    description: item.description,
    quantity: item.quantity,
    unitPrice: Math.round(item.unitPrice * discountRatio * 100) / 100,
  }));
}

/**
 * "Create staff id numbers"'s own sibling — sequential PER TENANT
 * ("QUO-0001", "QUO-0002", ...), zero-padded to 4 digits (falls back to
 * the real width past 9999). Same DISCLOSED LIMITATION as
 * formatStaffIdNumber(): computed from a live count at create() time, not
 * a real database sequence — two quotations created in the same instant
 * could race onto the same number. Acceptable for how a small tenant
 * actually creates quotations (one at a time, by hand); the migration's
 * own unique constraint on (tenant_id, quote_number) means a genuine
 * collision fails loudly rather than silently overwriting.
 */
export function formatQuoteNumber(sequence: number): string {
  return `QUO-${String(sequence).padStart(4, "0")}`;
}

@Injectable()
export class QuotationService {
  constructor(@Inject(QUOTATION_STORE) private readonly store: QuotationStore) {}

  async create(tenantId: string, id: string, input: CreateQuotationInput, createdByUserId?: string): Promise<Quotation> {
    validateLineItems(input.lineItems);
    const discountAmount = input.discountAmount ?? 0;
    const { subtotalAmount, totalAmount } = computeAmounts(input.lineItems, discountAmount);

    const quoteNumber = formatQuoteNumber((await this.store.findAllForTenant(tenantId)).length + 1);
    const lineItems: QuotationLineItem[] = input.lineItems.map((item) => ({ ...item, id: randomUUID() }));

    const quotation: Quotation = {
      id,
      tenantId,
      quoteNumber,
      customerId: input.customerId,
      lineItems,
      subtotalAmount,
      discountAmount,
      totalAmount,
      notes: input.notes?.trim() || undefined,
      customerAddress: input.customerAddress?.trim() || undefined,
      validUntil: input.validUntil,
      status: "draft",
      createdByUserId,
      createdAt: new Date(),
    };
    await this.store.save(quotation);
    return quotation;
  }

  async listForTenant(tenantId: string): Promise<Quotation[]> {
    return this.store.findAllForTenant(tenantId);
  }

  async findById(tenantId: string, id: string): Promise<Quotation | null> {
    return this.store.findById(tenantId, id);
  }

  async update(tenantId: string, id: string, input: UpdateQuotationInput): Promise<Quotation> {
    const existing = await this.store.findById(tenantId, id);
    if (!existing) throw new QuotationNotFoundError(id);

    const lineItemInputs: QuotationLineItemInput[] = input.lineItems ?? existing.lineItems;
    if (input.lineItems) validateLineItems(input.lineItems);
    const discountAmount = input.discountAmount !== undefined ? input.discountAmount : existing.discountAmount;
    const { subtotalAmount, totalAmount } = computeAmounts(lineItemInputs, discountAmount);

    const updated: Quotation = {
      ...existing,
      customerId: input.customerId === null ? undefined : (input.customerId ?? existing.customerId),
      lineItems: input.lineItems ? input.lineItems.map((item) => ({ ...item, id: randomUUID() })) : existing.lineItems,
      subtotalAmount,
      discountAmount,
      totalAmount,
      notes: input.notes !== undefined ? input.notes.trim() || undefined : existing.notes,
      customerAddress: input.customerAddress !== undefined ? input.customerAddress.trim() || undefined : existing.customerAddress,
      validUntil: input.validUntil === null ? undefined : (input.validUntil ?? existing.validUntil),
    };
    await this.store.save(updated);
    return updated;
  }

  /** Marks a quotation genuinely sent — QuotationController.send() is the
   * only real caller, and only after at least one channel has actually
   * succeeded (never called speculatively before a real send, same "log
   * after success" discipline as DealService.recordPublish()'s own
   * comment). Idempotent: sending again just refreshes sentAt. */
  async markSent(tenantId: string, id: string): Promise<Quotation> {
    const existing = await this.store.findById(tenantId, id);
    if (!existing) throw new QuotationNotFoundError(id);
    const updated: Quotation = { ...existing, status: "sent", sentAt: new Date() };
    await this.store.save(updated);
    return updated;
  }

  /** The one real write path for convertedToSaleId — QuotationController
   * .convertToSale() is the only caller, and only after a real Sale has
   * already been recorded (never speculatively before that succeeds,
   * same "log after success" discipline as markSent()'s own comment).
   * The eligibility gate itself (must be "sent", must not already be
   * converted) lives in the controller, right next to where the Sale
   * gets created, not here — same split as CustomerController.send*()'s
   * own precondition checks. */
  async markConverted(tenantId: string, id: string, saleId: string): Promise<Quotation> {
    const existing = await this.store.findById(tenantId, id);
    if (!existing) throw new QuotationNotFoundError(id);
    const updated: Quotation = { ...existing, convertedToSaleId: saleId };
    await this.store.save(updated);
    return updated;
  }

  /** The real, non-fabricated plain-text content every send channel uses
   * — built entirely from the quotation's own actual fields (line items,
   * real computed totals, real notes), same "never invent the copy"
   * discipline as ShiftBankingService.buildSlipText()/DealService
   * .buildDefaultMessage(). `tenantName`/`customerLabel` are the only two
   * pieces of context this can't compute itself. */
  buildQuotationText(quotation: Quotation, tenantName: string, customerLabel?: string): string {
    // "Must have item number" — the tenant's own explicit request
    // (2026-09-16). A real line number (1, 2, 3, ...), computed from each
    // item's own position — never stored, same "compute, never store the
    // derived value" discipline as PettyCashService.getBalance(): a
    // quotation's line items are only ever fully replaced as a set (see
    // update()'s own comment), never reordered independently, so there is
    // no drift risk in deriving this from array order every time.
    const lines = quotation.lineItems.map((item, index) => {
      const label = item.description ?? "Item";
      const lineTotal = Math.round(item.quantity * item.unitPrice * 100) / 100;
      return `  ${index + 1}. ${item.quantity} x ${label} @ ${item.unitPrice.toFixed(2)} = ${lineTotal.toFixed(2)}`;
    });
    const parts = [
      `Quotation ${quotation.quoteNumber} from ${tenantName}`,
      customerLabel ? `For: ${customerLabel}` : undefined,
      quotation.customerAddress ? quotation.customerAddress : undefined,
      "",
      ...lines,
      "",
      `Subtotal: ${quotation.subtotalAmount.toFixed(2)}`,
      quotation.discountAmount > 0 ? `Discount: -${quotation.discountAmount.toFixed(2)}` : undefined,
      `Total: ${quotation.totalAmount.toFixed(2)}`,
      quotation.validUntil ? `Valid until: ${quotation.validUntil.toLocaleDateString()}` : undefined,
      quotation.notes ? `\n${quotation.notes}` : undefined,
    ];
    return parts.filter((p) => p !== undefined).join("\n");
  }
}


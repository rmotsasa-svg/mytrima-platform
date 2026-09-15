import { QuotationService, InvalidQuotationError, QuotationNotFoundError, formatQuoteNumber } from "./quotation.service";
import { InMemoryQuotationStore } from "./in-memory-quotation.store";

function makeService() {
  return new QuotationService(new InMemoryQuotationStore());
}

test("formatQuoteNumber zero-pads to 4 digits", () => {
  expect(formatQuoteNumber(1)).toBe("QUO-0001");
  expect(formatQuoteNumber(42)).toBe("QUO-0042");
  expect(formatQuoteNumber(10000)).toBe("QUO-10000"); // real 5-digit sequence, not truncated
});

test("create computes a real subtotal/total from line items, with no discount by default", async () => {
  const service = makeService();
  const quotation = await service.create("t1", "q1", {
    lineItems: [
      { description: "Haircut", quantity: 2, unitPrice: 100 },
      { description: "Shampoo", quantity: 1, unitPrice: 50 },
    ],
  });
  expect(quotation.subtotalAmount).toBe(250);
  expect(quotation.discountAmount).toBe(0);
  expect(quotation.totalAmount).toBe(250);
  expect(quotation.status).toBe("draft");
});

test("create applies a real discount against the subtotal", async () => {
  const service = makeService();
  const quotation = await service.create("t1", "q1", {
    lineItems: [{ description: "Haircut", quantity: 1, unitPrice: 200 }],
    discountAmount: 50,
  });
  expect(quotation.subtotalAmount).toBe(200);
  expect(quotation.totalAmount).toBe(150);
});

test("create rejects a discount that exceeds the subtotal", async () => {
  const service = makeService();
  await expect(
    service.create("t1", "q1", { lineItems: [{ description: "Haircut", quantity: 1, unitPrice: 100 }], discountAmount: 150 })
  ).rejects.toThrow(InvalidQuotationError);
});

test("create rejects an empty line items list", async () => {
  const service = makeService();
  await expect(service.create("t1", "q1", { lineItems: [] })).rejects.toThrow(InvalidQuotationError);
});

test("create rejects a line item with neither catalogItemId nor description", async () => {
  const service = makeService();
  await expect(service.create("t1", "q1", { lineItems: [{ quantity: 1, unitPrice: 10 }] })).rejects.toThrow(InvalidQuotationError);
});

test("create rejects a non-positive quantity or a negative unitPrice", async () => {
  const service = makeService();
  await expect(service.create("t1", "q1", { lineItems: [{ description: "X", quantity: 0, unitPrice: 10 }] })).rejects.toThrow(InvalidQuotationError);
  await expect(service.create("t1", "q2", { lineItems: [{ description: "X", quantity: 1, unitPrice: -1 }] })).rejects.toThrow(InvalidQuotationError);
});

test("create assigns a real, sequential quoteNumber, per tenant", async () => {
  const service = makeService();
  const first = await service.create("t1", "q1", { lineItems: [{ description: "X", quantity: 1, unitPrice: 10 }] });
  const second = await service.create("t1", "q2", { lineItems: [{ description: "X", quantity: 1, unitPrice: 10 }] });
  expect(first.quoteNumber).toBe("QUO-0001");
  expect(second.quoteNumber).toBe("QUO-0002");
});

test("create's quoteNumber sequence is scoped per tenant — a second tenant also starts at 0001", async () => {
  const service = makeService();
  await service.create("t1", "q1", { lineItems: [{ description: "X", quantity: 1, unitPrice: 10 }] });
  const otherTenantQuote = await service.create("t2", "q2", { lineItems: [{ description: "X", quantity: 1, unitPrice: 10 }] });
  expect(otherTenantQuote.quoteNumber).toBe("QUO-0001");
});

test("create attributes createdByUserId when given", async () => {
  const service = makeService();
  const quotation = await service.create("t1", "q1", { lineItems: [{ description: "X", quantity: 1, unitPrice: 10 }] }, "staff-1");
  expect(quotation.createdByUserId).toBe("staff-1");
});

test("listForTenant is tenant-scoped", async () => {
  const service = makeService();
  await service.create("t1", "q1", { lineItems: [{ description: "X", quantity: 1, unitPrice: 10 }] });
  await service.create("t2", "q2", { lineItems: [{ description: "X", quantity: 1, unitPrice: 10 }] });
  const list = await service.listForTenant("t1");
  expect(list).toHaveLength(1);
});

test("findById returns null for a wrong tenant or unknown id", async () => {
  const service = makeService();
  await service.create("t1", "q1", { lineItems: [{ description: "X", quantity: 1, unitPrice: 10 }] });
  expect(await service.findById("t2", "q1")).toBeNull();
  expect(await service.findById("t1", "no-such-id")).toBeNull();
});

/* ---------- update ---------- */

test("update replaces line items and recomputes the total", async () => {
  const service = makeService();
  await service.create("t1", "q1", { lineItems: [{ description: "Haircut", quantity: 1, unitPrice: 100 }] });
  const updated = await service.update("t1", "q1", { lineItems: [{ description: "Haircut", quantity: 2, unitPrice: 120 }] });
  expect(updated.subtotalAmount).toBe(240);
  expect(updated.totalAmount).toBe(240);
});

test("update leaves line items untouched when omitted, but can change discountAmount alone", async () => {
  const service = makeService();
  await service.create("t1", "q1", { lineItems: [{ description: "Haircut", quantity: 1, unitPrice: 200 }] });
  const updated = await service.update("t1", "q1", { discountAmount: 20 });
  expect(updated.subtotalAmount).toBe(200);
  expect(updated.totalAmount).toBe(180);
  expect(updated.lineItems).toHaveLength(1);
});

test("update clears validUntil on explicit null, keeps it on omission", async () => {
  const service = makeService();
  const created = await service.create("t1", "q1", { lineItems: [{ description: "X", quantity: 1, unitPrice: 10 }], validUntil: new Date("2027-01-01") });
  expect(created.validUntil).toEqual(new Date("2027-01-01"));

  const kept = await service.update("t1", "q1", { notes: "just a note" });
  expect(kept.validUntil).toEqual(new Date("2027-01-01"));

  const cleared = await service.update("t1", "q1", { validUntil: null });
  expect(cleared.validUntil).toBeUndefined();
});

test("update throws QuotationNotFoundError for a wrong tenant or unknown id", async () => {
  const service = makeService();
  await service.create("t1", "q1", { lineItems: [{ description: "X", quantity: 1, unitPrice: 10 }] });
  await expect(service.update("t2", "q1", { notes: "x" })).rejects.toThrow(QuotationNotFoundError);
  await expect(service.update("t1", "no-such-id", { notes: "x" })).rejects.toThrow(QuotationNotFoundError);
});

/* ---------- markSent ---------- */

test("markSent flips status to 'sent' and stamps a real sentAt", async () => {
  const service = makeService();
  const created = await service.create("t1", "q1", { lineItems: [{ description: "X", quantity: 1, unitPrice: 10 }] });
  expect(created.status).toBe("draft");
  expect(created.sentAt).toBeUndefined();

  const sent = await service.markSent("t1", "q1");
  expect(sent.status).toBe("sent");
  expect(sent.sentAt).toBeInstanceOf(Date);
});

/* ---------- customerAddress (2026-09-16) ---------- */

test("create saves a real customerAddress", async () => {
  const service = makeService();
  const quotation = await service.create("t1", "q1", {
    lineItems: [{ description: "X", quantity: 1, unitPrice: 10 }],
    customerAddress: "12 Kingsway, Maseru 100",
  });
  expect(quotation.customerAddress).toBe("12 Kingsway, Maseru 100");
});

test("create leaves customerAddress unset when not given — not a fabricated default", async () => {
  const service = makeService();
  const quotation = await service.create("t1", "q1", { lineItems: [{ description: "X", quantity: 1, unitPrice: 10 }] });
  expect(quotation.customerAddress).toBeUndefined();
});

test("update sets customerAddress without touching other fields, and an explicit empty string clears it", async () => {
  const service = makeService();
  await service.create("t1", "q1", { lineItems: [{ description: "X", quantity: 1, unitPrice: 10 }], notes: "keep me" });
  const updated = await service.update("t1", "q1", { customerAddress: "12 Kingsway, Maseru 100" });
  expect(updated.customerAddress).toBe("12 Kingsway, Maseru 100");
  expect(updated.notes).toBe("keep me");

  const cleared = await service.update("t1", "q1", { customerAddress: "" });
  expect(cleared.customerAddress).toBeUndefined();
});

/* ---------- buildQuotationText ---------- */

test("buildQuotationText includes the real quote number, customer address, numbered line items, and computed total", async () => {
  const service = makeService();
  const quotation = await service.create("t1", "q1", {
    lineItems: [
      { description: "Haircut", quantity: 2, unitPrice: 100 },
      { description: "Shampoo", quantity: 1, unitPrice: 30 },
    ],
    discountAmount: 20,
    notes: "Thanks for your business.",
    customerAddress: "12 Kingsway, Maseru 100",
  });
  const text = service.buildQuotationText(quotation, "Test Salon", "Palesa");
  expect(text).toContain("QUO-0001");
  expect(text).toContain("Test Salon");
  expect(text).toContain("For: Palesa");
  expect(text).toContain("12 Kingsway, Maseru 100");
  expect(text).toContain("1. 2 x Haircut");
  expect(text).toContain("2. 1 x Shampoo");
  expect(text).toContain("Subtotal: 230.00");
  expect(text).toContain("Discount: -20.00");
  expect(text).toContain("Total: 210.00");
  expect(text).toContain("Thanks for your business.");
});

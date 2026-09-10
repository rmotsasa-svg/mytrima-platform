import { PayFastService, PayFastConfigError, buildSignature, buildSignatureFromRawFields, phpUrlEncode } from "./payfast.service";

/**
 * These tests mock `fetch` only for confirmWithPayFastServer — everything
 * else (signature generation, field construction) needs no network at all,
 * matching PayFast's own real integration model (see this file's own top
 * comment). The reference signature below was computed independently with
 * Node's own `crypto` module against the exact field values used here, not
 * copied from PayFast's docs (their own example signature isn't tied to
 * published field values, so it can't be reproduced as a fixture) — see
 * payfast.service.ts's own comment on why. See README.md for the real
 * sandbox live-verification this client was actually run against.
 */

function mockFetchResolvedOnce(text: string): jest.Mock {
  const mock = jest.fn().mockResolvedValue({ text: async () => text });
  (globalThis as unknown as { fetch: typeof fetch }).fetch = mock as unknown as typeof fetch;
  return mock;
}

describe("phpUrlEncode", () => {
  test("encodes a space as + (not %20, unlike encodeURIComponent)", () => {
    expect(phpUrlEncode("Test Item")).toBe("Test+Item");
  });

  test("leaves alphanumerics and -_. unescaped", () => {
    expect(phpUrlEncode("abc-123_XYZ.value")).toBe("abc-123_XYZ.value");
  });

  test("percent-encodes reserved/punctuation characters PHP's urlencode escapes, unlike encodeURIComponent which leaves them", () => {
    // encodeURIComponent leaves !~*'() unescaped by default — PHP's
    // urlencode() escapes all of them. This is the exact class of subtle
    // mismatch that produces a signature PayFast's server never accepts.
    expect(phpUrlEncode("!~*'()")).toBe("%21%7E%2A%27%28%29");
  });

  test("percent-encodes with uppercase hex digits, per PayFast's own documented requirement", () => {
    expect(phpUrlEncode("/")).toBe("%2F");
    expect(phpUrlEncode(":")).toBe("%3A");
  });
});

describe("buildSignature", () => {
  test("matches an independently-computed MD5 reference value for a known field set", () => {
    const signature = buildSignature(
      {
        merchant_id: "10000100",
        merchant_key: "46f0cd694581a",
        return_url: "https://example.com/return",
        cancel_url: "https://example.com/cancel",
        notify_url: "https://example.com/notify",
        m_payment_id: "order-1",
        amount: "100.00",
        item_name: "Test Item",
      },
      "jt7NOE43FZPn"
    );
    expect(signature).toBe("2aa57f5b31286bd886d62f7797a0b17e");
  });

  test("blank/undefined fields are excluded entirely, not sent as empty pairs", () => {
    const withBlank = buildSignature({ merchant_id: "1", merchant_key: "k", name_first: "" }, undefined);
    const withoutBlank = buildSignature({ merchant_id: "1", merchant_key: "k" }, undefined);
    expect(withBlank).toBe(withoutBlank);
  });

  test("field order in the signature follows the documented attribute order, not insertion order", () => {
    // amount is passed before merchant_id here — buildSignature must still
    // put merchant_id first, since the signature is order-sensitive.
    const outOfOrder = buildSignature({ amount: "50.00", merchant_id: "1", merchant_key: "k" }, "pass");
    const inOrder = buildSignature({ merchant_id: "1", merchant_key: "k", amount: "50.00" }, "pass");
    expect(outOfOrder).toBe(inOrder);
  });
});

describe("buildSignatureFromRawFields", () => {
  test("matches an independently-computed MD5 reference value for a realistic ITN field set", () => {
    const signature = buildSignatureFromRawFields(
      {
        m_payment_id: "order-1",
        pf_payment_id: "1089250",
        payment_status: "COMPLETE",
        item_name: "Test Item",
        amount_gross: "100.00",
        merchant_id: "10000100",
      },
      "jt7NOE43FZPn"
    );
    expect(signature).toBe("30a5182814fb7715cad6aec3105a8d4f");
  });

  test("excludes the signature field itself even when present in the input", () => {
    const withSignature = buildSignatureFromRawFields({ merchant_id: "1", amount_gross: "50.00", signature: "whatever" }, "pass");
    const withoutSignature = buildSignatureFromRawFields({ merchant_id: "1", amount_gross: "50.00" }, "pass");
    expect(withSignature).toBe(withoutSignature);
  });

  test("unlike buildSignature, follows the fields' own arrival order — reordering genuinely changes the result", () => {
    // This is the whole point of the distinction (see this file's own real
    // bug comment): an ITN's signature depends on arrival order, which
    // buildSignature's fixed canonical order cannot reproduce.
    const orderA = buildSignatureFromRawFields({ merchant_id: "1", amount_gross: "50.00" }, "pass");
    const orderB = buildSignatureFromRawFields({ amount_gross: "50.00", merchant_id: "1" }, "pass");
    expect(orderA).not.toBe(orderB);
  });

  test("blank fields are excluded entirely, not sent as empty pairs", () => {
    const withBlank = buildSignatureFromRawFields({ merchant_id: "1", name_first: "" }, undefined);
    const withoutBlank = buildSignatureFromRawFields({ merchant_id: "1" }, undefined);
    expect(withBlank).toBe(withoutBlank);
  });
});

describe("PayFastService.buildPaymentRequest", () => {
  const service = new PayFastService({ merchantId: "10000100", merchantKey: "46f0cd694581a", passphrase: "jt7NOE43FZPn", sandbox: true });

  test("uses the sandbox process URL when sandbox: true", () => {
    const result = service.buildPaymentRequest({
      amount: "100.00",
      itemName: "Test Item",
      mPaymentId: "order-1",
      returnUrl: "https://example.com/return",
      cancelUrl: "https://example.com/cancel",
      notifyUrl: "https://example.com/notify",
    });
    expect(result.actionUrl).toBe("https://sandbox.payfast.co.za/eng/process");
  });

  test("uses the live process URL when sandbox: false", () => {
    const liveService = new PayFastService({ merchantId: "10000100", merchantKey: "46f0cd694581a", sandbox: false });
    const result = liveService.buildPaymentRequest({
      amount: "100.00",
      itemName: "Test Item",
      mPaymentId: "order-1",
      returnUrl: "https://example.com/return",
      cancelUrl: "https://example.com/cancel",
      notifyUrl: "https://example.com/notify",
    });
    expect(result.actionUrl).toBe("https://www.payfast.co.za/eng/process");
  });

  test("includes a real, matching signature field computed the same way buildSignature does", () => {
    const result = service.buildPaymentRequest({
      amount: "100.00",
      itemName: "Test Item",
      mPaymentId: "order-1",
      returnUrl: "https://example.com/return",
      cancelUrl: "https://example.com/cancel",
      notifyUrl: "https://example.com/notify",
    });
    const signatureField = result.fields.find((f) => f.name === "signature");
    expect(signatureField?.value).toBe("2aa57f5b31286bd886d62f7797a0b17e");
  });

  test("adds a setup field with the split payment JSON, which is NOT part of the signature", () => {
    const withSplit = service.buildPaymentRequest({
      amount: "100.00",
      itemName: "Test Item",
      mPaymentId: "order-1",
      returnUrl: "https://example.com/return",
      cancelUrl: "https://example.com/cancel",
      notifyUrl: "https://example.com/notify",
      splitPayment: { merchantId: "10000105", percentage: 90, min: 100, max: 100000 },
    });
    const withoutSplit = service.buildPaymentRequest({
      amount: "100.00",
      itemName: "Test Item",
      mPaymentId: "order-1",
      returnUrl: "https://example.com/return",
      cancelUrl: "https://example.com/cancel",
      notifyUrl: "https://example.com/notify",
    });

    const signatureWith = withSplit.fields.find((f) => f.name === "signature")?.value;
    const signatureWithout = withoutSplit.fields.find((f) => f.name === "signature")?.value;
    expect(signatureWith).toBe(signatureWithout);

    const setupField = withSplit.fields.find((f) => f.name === "setup");
    expect(setupField).toBeDefined();
    expect(JSON.parse(setupField!.value)).toEqual({
      split_payment: { merchant_id: 10000105, percentage: 90, min: 100, max: 100000 },
    });
  });

  test("throws PayFastConfigError when a split payment is given with neither amount nor percentage", () => {
    expect(() =>
      service.buildPaymentRequest({
        amount: "100.00",
        itemName: "Test Item",
        mPaymentId: "order-1",
        returnUrl: "https://example.com/return",
        cancelUrl: "https://example.com/cancel",
        notifyUrl: "https://example.com/notify",
        splitPayment: { merchantId: "10000105" },
      })
    ).toThrow(PayFastConfigError);
  });
});

describe("PayFastService.verifyItnSignature", () => {
  const service = new PayFastService({ merchantId: "10000100", merchantKey: "46f0cd694581a", passphrase: "jt7NOE43FZPn", sandbox: true });

  // REAL BUG (see payfast.service.ts's own "REAL BUG, found 2026-09-10"
  // comment on buildSignatureFromRawFields): this fixture uses genuine ITN
  // field names (pf_payment_id, payment_status, amount_gross) — a
  // different set from the outbound checkout request's own fields
  // (merchant_key, return_url, cancel_url, notify_url, amount) — deliberately,
  // since reusing the outbound field list for ITN verification is exactly
  // the bug a real self-signed ITN posted through /payments/itn caught live.
  test("returns true for an ITN whose signature genuinely matches its own fields, using the real ITN field set and arrival order", () => {
    const fields = {
      m_payment_id: "order-1",
      pf_payment_id: "1089250",
      payment_status: "COMPLETE",
      item_name: "Test Item",
      amount_gross: "100.00",
      merchant_id: "10000100",
      signature: "30a5182814fb7715cad6aec3105a8d4f",
    };
    expect(service.verifyItnSignature(fields)).toBe(true);
  });

  test("returns false when a field has been tampered with after signing", () => {
    const fields = {
      m_payment_id: "order-1",
      pf_payment_id: "1089250",
      payment_status: "COMPLETE",
      item_name: "Test Item",
      amount_gross: "999999.00", // tampered
      merchant_id: "10000100",
      signature: "30a5182814fb7715cad6aec3105a8d4f",
    };
    expect(service.verifyItnSignature(fields)).toBe(false);
  });
});

describe("PayFastService.confirmWithPayFastServer", () => {
  const service = new PayFastService({ merchantId: "10000100", merchantKey: "46f0cd694581a", sandbox: true });

  test("returns true when PayFast's server responds VALID", async () => {
    mockFetchResolvedOnce("VALID");
    const result = await service.confirmWithPayFastServer({ merchant_id: "10000100", amount_gross: "100.00" });
    expect(result).toBe(true);
  });

  test("returns false when PayFast's server responds INVALID", async () => {
    mockFetchResolvedOnce("INVALID");
    const result = await service.confirmWithPayFastServer({ merchant_id: "10000100", amount_gross: "100.00" });
    expect(result).toBe(false);
  });

  test("posts to the sandbox validate URL, excluding the signature field itself from the body", async () => {
    const fetchMock = mockFetchResolvedOnce("VALID");
    await service.confirmWithPayFastServer({ merchant_id: "10000100", amount_gross: "100.00", signature: "abc123" });
    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://sandbox.payfast.co.za/eng/query/validate");
    expect(options.body as string).not.toContain("signature=");
  });
});

import { MoPayService, InvalidPaymentReferenceError, MoPayApiError } from "./mopay.service";

/**
 * These tests mock `fetch` for deterministic, network-free CI runs. A real
 * sandbox API key was used once, separately (not in this suite, and not
 * committed anywhere), to confirm createPaymentSession/getSession actually
 * work against the live API — see mopay.service.ts's class comment. That
 * live call is also what surfaced the exact over-inclusive response shape
 * the "getSession never forwards MoPay's raw session object" test below
 * mocks — it's modeling a real confirmed response, not a hypothetical one.
 */

function mockFetchResolvedOnce(status: number, body: unknown): jest.Mock {
  const mock = jest.fn().mockResolvedValue({ status, json: async () => body });
  (globalThis as unknown as { fetch: typeof fetch }).fetch = mock as unknown as typeof fetch;
  return mock;
}

test("createPaymentSession rejects a non-alphanumeric reference without making a network call", async () => {
  const fetchMock = mockFetchResolvedOnce(200, {});
  const service = new MoPayService("test-key");
  await expect(
    service.createPaymentSession({ amount: "100.00", reference: "ORDER-123", redirectUrl: "https://example.com/done" })
  ).rejects.toThrow(InvalidPaymentReferenceError);
  expect(fetchMock).not.toHaveBeenCalled();
});

test("createPaymentSession posts to the documented endpoint with the Bearer auth header and JSON body", async () => {
  const fetchMock = mockFetchResolvedOnce(200, {
    success: true,
    sessionId: "MOP_abc123_ORDER123",
    paymentUrl: "https://mopay.co.ls/pay/MOP_abc123_ORDER123",
    reference: "ORDER123",
    amount: "100.00",
  });
  const service = new MoPayService("sandbox-key-123");

  const result = await service.createPaymentSession({
    amount: "100.00",
    reference: "ORDER123",
    redirectUrl: "https://example.com/payment-complete",
  });

  expect(result).toEqual({
    sessionId: "MOP_abc123_ORDER123",
    paymentUrl: "https://mopay.co.ls/pay/MOP_abc123_ORDER123",
    reference: "ORDER123",
    amount: "100.00",
  });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
  expect(url).toBe("https://mopay.co.ls/api/external/payment");
  expect(options.method).toBe("POST");
  expect((options.headers as Record<string, string>).Authorization).toBe("Bearer sandbox-key-123");
  expect(JSON.parse(options.body as string)).toMatchObject({ amount: "100.00", reference: "ORDER123" });
});

test("createPaymentSession throws MoPayApiError when the API responds with success: false", async () => {
  mockFetchResolvedOnce(400, { success: false, error: "Invalid request data" });
  const service = new MoPayService("test-key");
  await expect(
    service.createPaymentSession({ amount: "100.00", reference: "ORDER123", redirectUrl: "https://example.com/done" })
  ).rejects.toThrow(MoPayApiError);
});

test("getSession calls the documented session endpoint and returns the parsed session", async () => {
  const fetchMock = mockFetchResolvedOnce(200, {
    success: true,
    session: {
      sessionId: "MOP_abc123_ORDER123",
      amount: "100.00",
      reference: "ORDER123",
      status: "COMPLETED",
      transactionStatus: "success",
      transactionId: "TXN123",
      selectedPaymentMethod: "mpesa",
    },
  });
  const service = new MoPayService("test-key");

  const details = await service.getSession("MOP_abc123_ORDER123");

  expect(details.status).toBe("COMPLETED");
  expect(details.transactionStatus).toBe("success");
  expect(details.selectedPaymentMethod).toBe("mpesa");
  const [url] = fetchMock.mock.calls[0] as [string];
  expect(url).toBe("https://mopay.co.ls/api/external/session/v1/MOP_abc123_ORDER123");
});

test("getSession throws MoPayApiError when the API responds with success: false", async () => {
  mockFetchResolvedOnce(404, { success: false, error: "Session not found" });
  const service = new MoPayService("test-key");
  await expect(service.getSession("nonexistent")).rejects.toThrow(MoPayApiError);
});

/**
 * Regression test for a real finding from a live sandbox call: MoPay's
 * actual session-detail response is far larger than the public docs show,
 * and includes the raw project API key (twice — once directly, once nested
 * under `project.apiKey`) plus the account owner's name and email under
 * `project.user`. This asserts getSession() picks only the documented,
 * safe fields off that response rather than passing it through wholesale —
 * so a caller can never accidentally serialize the result into an HTTP
 * response, log line, or webhook payload and leak the API key.
 */
test("getSession never forwards MoPay's raw session object — API key and account owner info must not leak through", async () => {
  mockFetchResolvedOnce(200, {
    success: true,
    session: {
      sessionId: "MOP_abc123_ORDER123",
      amount: "100.00",
      reference: "ORDER123",
      status: "CREATED",
      transactionStatus: null,
      apiKey: "super-secret-real-api-key",
      project: {
        apiKey: "super-secret-real-api-key",
        user: { name: "Real Account Owner", email: "owner@example.com" },
      },
    },
  });
  const service = new MoPayService("test-key");

  const details = await service.getSession("MOP_abc123_ORDER123");

  const serialized = JSON.stringify(details);
  expect(serialized).not.toContain("super-secret-real-api-key");
  expect(serialized).not.toContain("Real Account Owner");
  expect(serialized).not.toContain("owner@example.com");
  expect(Object.keys(details).sort()).toEqual(
    ["amount", "reference", "selectedPaymentMethod", "sessionId", "status", "transactionId", "transactionStatus"].sort()
  );
});

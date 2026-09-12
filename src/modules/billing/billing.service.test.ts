import {
  BillingService,
  UnknownPackageError,
  PackageNotSelfServeError,
  MoPayNotConfiguredError,
  SubscriptionPaymentNotFoundError,
} from "./billing.service";
import { InMemorySubscriptionStore, InMemorySubscriptionPaymentStore } from "./in-memory-billing.store";

/** Same fetch-mocking convention as mopay.service.test.ts itself —
 * deterministic, no real network call, modeling real confirmed response
 * shapes (mopay.service.ts's own class comment documents the real
 * sandbox call these shapes are drawn from). */
function mockFetchResolvedOnce(body: unknown): jest.Mock {
  const mock = jest.fn().mockResolvedValue({ json: async () => body });
  (globalThis as unknown as { fetch: typeof fetch }).fetch = mock as unknown as typeof fetch;
  return mock;
}

function makeService(apiKey = "test-mopay-key") {
  const subscriptions = new InMemorySubscriptionStore();
  const payments = new InMemorySubscriptionPaymentStore();
  const service = new BillingService(subscriptions, payments, apiKey);
  return { service, subscriptions, payments };
}

test("getCurrentSubscription defaults to a real, active Start Free — not a fabricated placeholder — when no record exists yet", async () => {
  const { service } = makeService();
  const subscription = await service.getCurrentSubscription("t1");
  expect(subscription).toMatchObject({ tenantId: "t1", package: "Start Free", status: "active" });
});

test("startCheckout rejects a package name that isn't real", async () => {
  const { service } = makeService();
  await expect(service.startCheckout("t1", "Not A Real Package", "https://example.com/done")).rejects.toThrow(UnknownPackageError);
});

test("startCheckout rejects Enterprise — no fixed price, not self-serve", async () => {
  const { service } = makeService();
  await expect(service.startCheckout("t1", "Enterprise", "https://example.com/done")).rejects.toThrow(PackageNotSelfServeError);
});

test("startCheckout throws MoPayNotConfiguredError when MOPAY_API_KEY is unset, before ever calling MoPay", async () => {
  const fetchMock = mockFetchResolvedOnce({});
  const { service } = makeService("");
  await expect(service.startCheckout("t1", "Pro Plus", "https://example.com/done")).rejects.toThrow(MoPayNotConfiguredError);
  expect(fetchMock).not.toHaveBeenCalled();
});

test("startCheckout creates a real MoPay session with the package's real price, and records a real 'created' payment", async () => {
  const fetchMock = mockFetchResolvedOnce({
    success: true,
    sessionId: "MOP_test_session",
    paymentUrl: "https://mopay.co.ls/pay/MOP_test_session",
    reference: "t1123456789",
    amount: "350.00",
  });
  const { service, payments } = makeService();

  const result = await service.startCheckout("t1", "Pro Plus", "https://app.mytrima.co.za/billing");

  expect(result.paymentUrl).toBe("https://mopay.co.ls/pay/MOP_test_session");
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
  const body = JSON.parse(options.body as string);
  expect(body.amount).toBe("350.00"); // Pro Plus's real price, not fabricated
  expect(body.redirectUrl).toBe("https://app.mytrima.co.za/billing");

  const recorded = await payments.findById("t1", result.paymentId);
  expect(recorded).toMatchObject({ package: "Pro Plus", amount: 350, status: "created", mopaySessionId: "MOP_test_session" });
});

test("verifyPayment throws SubscriptionPaymentNotFoundError for an id that was never created", async () => {
  const { service } = makeService();
  await expect(service.verifyPayment("t1", "no-such-payment")).rejects.toThrow(SubscriptionPaymentNotFoundError);
});

test("verifyPayment on a real MoPay success marks the payment completed and activates the new subscription", async () => {
  const { service, subscriptions } = makeService();
  mockFetchResolvedOnce({
    success: true,
    sessionId: "MOP_ok",
    paymentUrl: "https://mopay.co.ls/pay/MOP_ok",
    reference: "ref1",
    amount: "420.00",
  });
  const { paymentId } = await service.startCheckout("t1", "Growth Plan", "https://example.com/done");

  mockFetchResolvedOnce({
    success: true,
    session: { sessionId: "MOP_ok", amount: "420.00", reference: "ref1", status: "COMPLETED", transactionStatus: "success" },
  });
  const { payment, subscription } = await service.verifyPayment("t1", paymentId);

  expect(payment.status).toBe("completed");
  expect(payment.completedAt).toBeInstanceOf(Date);
  expect(subscription).toMatchObject({ tenantId: "t1", package: "Growth Plan", status: "active" });
  expect(subscription.currentPeriodEnd).toBeInstanceOf(Date);
  expect((await subscriptions.find("t1"))?.package).toBe("Growth Plan");
});

test("verifyPayment on a real MoPay failure marks the payment failed and does NOT touch the subscription", async () => {
  const { service, subscriptions } = makeService();
  mockFetchResolvedOnce({
    success: true,
    sessionId: "MOP_fail",
    paymentUrl: "https://mopay.co.ls/pay/MOP_fail",
    reference: "ref2",
    amount: "600.00",
  });
  const { paymentId } = await service.startCheckout("t1", "Growth Partner", "https://example.com/done");

  mockFetchResolvedOnce({
    success: true,
    session: { sessionId: "MOP_fail", amount: "600.00", reference: "ref2", status: "FAILED", transactionStatus: "failed" },
  });
  const { payment } = await service.verifyPayment("t1", paymentId);

  expect(payment.status).toBe("failed");
  expect(payment.completedAt).toBeUndefined();
  expect(await subscriptions.find("t1")).toBeNull(); // still no real subscription row — tenant stays on Start Free
});

test("verifyPayment is idempotent — a second call on an already-resolved payment doesn't call MoPay again", async () => {
  const { service } = makeService();
  mockFetchResolvedOnce({
    success: true,
    sessionId: "MOP_idem",
    paymentUrl: "https://mopay.co.ls/pay/MOP_idem",
    reference: "ref3",
    amount: "350.00",
  });
  const { paymentId } = await service.startCheckout("t1", "Pro Plus", "https://example.com/done");

  mockFetchResolvedOnce({
    success: true,
    session: { sessionId: "MOP_idem", amount: "350.00", reference: "ref3", status: "COMPLETED", transactionStatus: "success" },
  });
  await service.verifyPayment("t1", paymentId);

  const secondCallFetch = mockFetchResolvedOnce({});
  const { payment } = await service.verifyPayment("t1", paymentId);
  expect(payment.status).toBe("completed");
  expect(secondCallFetch).not.toHaveBeenCalled();
});

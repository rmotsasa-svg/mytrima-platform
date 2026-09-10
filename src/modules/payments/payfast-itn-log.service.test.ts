import { randomUUID } from "node:crypto";
import { PayfastItnLogService } from "./payfast-itn-log.service";
import { InMemoryPayfastItnLogStore } from "./in-memory-payfast-itn-log.store";

function makeEntry(overrides: Partial<Parameters<PayfastItnLogService["record"]>[0]> = {}) {
  return {
    id: randomUUID(),
    tenantId: "t1",
    mPaymentId: "t1:order-1",
    pfPaymentId: "1089250",
    paymentStatus: "COMPLETE",
    amountGross: "100.00",
    signatureValid: true,
    serverConfirmed: true,
    rawPayload: { merchant_id: "10000100" },
    ...overrides,
  };
}

test("record then listForTenant returns the real logged entry, with a real receivedAt timestamp assigned", async () => {
  const service = new PayfastItnLogService(new InMemoryPayfastItnLogStore());
  await service.record(makeEntry());

  const entries = await service.listForTenant("t1");
  expect(entries).toHaveLength(1);
  expect(entries[0].pfPaymentId).toBe("1089250");
  expect(entries[0].receivedAt).toBeInstanceOf(Date);
});

test("listForTenant is tenant-scoped", async () => {
  const service = new PayfastItnLogService(new InMemoryPayfastItnLogStore());
  await service.record(makeEntry({ tenantId: "t1" }));
  await service.record(makeEntry({ tenantId: "t2", pfPaymentId: "other-tenant-payment" }));

  const entries = await service.listForTenant("t1");
  expect(entries).toHaveLength(1);
  expect(entries[0].pfPaymentId).toBe("1089250");
});

test("a failed-verification ITN is still recorded, not silently dropped", async () => {
  const service = new PayfastItnLogService(new InMemoryPayfastItnLogStore());
  await service.record(makeEntry({ signatureValid: false, serverConfirmed: false }));

  const entries = await service.listForTenant("t1");
  expect(entries[0].signatureValid).toBe(false);
  expect(entries[0].serverConfirmed).toBe(false);
});

/**
 * Real gap found by deep review (see migration 0016's own comment):
 * PayFast retries an ITN whose notify_url didn't return HTTP 200,
 * resending the identical payload. Recording the same (tenantId,
 * pfPaymentId) twice must not create a duplicate row.
 */
test("recording the same (tenantId, pfPaymentId) twice — a real PayFast retry — is idempotent, not a duplicate", async () => {
  const service = new PayfastItnLogService(new InMemoryPayfastItnLogStore());
  await service.record(makeEntry());
  await service.record(makeEntry()); // the retry — same tenantId + pfPaymentId

  const entries = await service.listForTenant("t1");
  expect(entries).toHaveLength(1);
});

test("a different pfPaymentId for the same tenant is still recorded as its own entry", async () => {
  const service = new PayfastItnLogService(new InMemoryPayfastItnLogStore());
  await service.record(makeEntry({ pfPaymentId: "1089250" }));
  await service.record(makeEntry({ pfPaymentId: "1089251" }));

  const entries = await service.listForTenant("t1");
  expect(entries).toHaveLength(2);
});

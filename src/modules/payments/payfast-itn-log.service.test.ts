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

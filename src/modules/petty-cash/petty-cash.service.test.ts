import { PettyCashService, InvalidPettyCashTransactionError } from "./petty-cash.service";
import { InMemoryPettyCashStore } from "./in-memory-petty-cash.store";
import { VendorService } from "./vendor.service";
import { InMemoryVendorStore } from "./in-memory-vendor.store";

function makeServices() {
  const vendorService = new VendorService(new InMemoryVendorStore());
  const pettyCashService = new PettyCashService(new InMemoryPettyCashStore(), vendorService);
  return { vendorService, pettyCashService };
}

test("replenish then payVendor are both recorded, and the balance reflects both", async () => {
  const { vendorService, pettyCashService } = makeServices();
  const vendor = await vendorService.create("t1", "v1", "Acme Supplies");

  await pettyCashService.replenish("t1", "p1", 500, "Weekly float top-up");
  await pettyCashService.payVendor("t1", "p2", vendor.id, 120, "Delivery fee");

  const balance = await pettyCashService.getBalance("t1");
  expect(balance).toBe(380);

  const ledger = await pettyCashService.getLedger("t1");
  expect(ledger).toHaveLength(2);
});

test("payVendor rejects an unknown vendor", async () => {
  const { pettyCashService } = makeServices();
  await expect(pettyCashService.payVendor("t1", "p1", "no-such-vendor", 50)).rejects.toThrow(InvalidPettyCashTransactionError);
});

test("payVendor rejects paying a vendor that belongs to a different tenant", async () => {
  const { vendorService, pettyCashService } = makeServices();
  const vendor = await vendorService.create("t2", "v1", "Other tenant's vendor");
  await expect(pettyCashService.payVendor("t1", "p1", vendor.id, 50)).rejects.toThrow(InvalidPettyCashTransactionError);
});

test("replenish/payVendor reject a non-positive amount", async () => {
  const { vendorService, pettyCashService } = makeServices();
  const vendor = await vendorService.create("t1", "v1", "Acme Supplies");
  await expect(pettyCashService.replenish("t1", "p1", 0)).rejects.toThrow(InvalidPettyCashTransactionError);
  await expect(pettyCashService.payVendor("t1", "p2", vendor.id, -10)).rejects.toThrow(InvalidPettyCashTransactionError);
});

test("balance is tenant-scoped", async () => {
  const { pettyCashService } = makeServices();
  await pettyCashService.replenish("t1", "p1", 500);
  await pettyCashService.replenish("t2", "p2", 9999);
  expect(await pettyCashService.getBalance("t1")).toBe(500);
});

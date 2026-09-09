import { VendorService, InvalidVendorError } from "./vendor.service";
import { InMemoryVendorStore } from "./in-memory-vendor.store";

test("create persists a vendor", async () => {
  const service = new VendorService(new InMemoryVendorStore());
  const vendor = await service.create("t1", "v1", "Acme Supplies", "+26650001111");
  expect(vendor.name).toBe("Acme Supplies");
  expect(vendor.isActive).toBe(true);
});

test("create rejects an empty name", async () => {
  const service = new VendorService(new InMemoryVendorStore());
  await expect(service.create("t1", "v1", "  ")).rejects.toThrow(InvalidVendorError);
});

test("listForTenant is tenant-scoped", async () => {
  const service = new VendorService(new InMemoryVendorStore());
  await service.create("t1", "v1", "Tenant 1's vendor");
  await service.create("t2", "v2", "Tenant 2's vendor");
  const list = await service.listForTenant("t1");
  expect(list).toHaveLength(1);
  expect(list[0].name).toBe("Tenant 1's vendor");
});

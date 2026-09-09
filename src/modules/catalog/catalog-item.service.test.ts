import { CatalogService, InvalidCatalogItemError, CatalogItemNotFoundError } from "./catalog-item.service";
import { InMemoryCatalogItemStore } from "./in-memory-catalog-item.store";

function makeService(): CatalogService {
  return new CatalogService(new InMemoryCatalogItemStore());
}

test("create persists an item with the given fields", async () => {
  const service = makeService();
  const item = await service.create("t1", "i1", "Haircut", "service", 150);
  expect(item.name).toBe("Haircut");
  expect(item.itemType).toBe("service");
  expect(item.unitPrice).toBe(150);
  expect(item.isActive).toBe(true);
});

test("create rejects an empty name", async () => {
  const service = makeService();
  await expect(service.create("t1", "i1", "  ", "product", 10)).rejects.toThrow(InvalidCatalogItemError);
});

test("create rejects a negative unitPrice", async () => {
  const service = makeService();
  await expect(service.create("t1", "i1", "Widget", "product", -5)).rejects.toThrow(InvalidCatalogItemError);
});

test("listForTenant is tenant-scoped", async () => {
  const service = makeService();
  await service.create("t1", "i1", "Widget", "product", 10);
  await service.create("t2", "i2", "Other tenant's item", "product", 10);
  const list = await service.listForTenant("t1");
  expect(list).toHaveLength(1);
  expect(list[0].name).toBe("Widget");
});

test("update is a true partial update — an omitted field keeps its existing value", async () => {
  const service = makeService();
  await service.create("t1", "i1", "Widget", "product", 10, "SKU-1");
  const updated = await service.update("t1", "i1", "Renamed Widget");
  expect(updated.name).toBe("Renamed Widget");
  expect(updated.unitPrice).toBe(10);
  expect(updated.sku).toBe("SKU-1");
});

test("update throws CatalogItemNotFoundError for a wrong tenant or unknown id", async () => {
  const service = makeService();
  await service.create("t1", "i1", "Widget", "product", 10);
  await expect(service.update("t2", "i1", "Hijacked")).rejects.toThrow(CatalogItemNotFoundError);
  await expect(service.update("t1", "unknown", "X")).rejects.toThrow(CatalogItemNotFoundError);
});

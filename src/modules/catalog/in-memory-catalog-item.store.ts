import { CatalogItem, CatalogItemStore } from "./catalog-item.service";

export class InMemoryCatalogItemStore implements CatalogItemStore {
  private readonly items = new Map<string, CatalogItem>();

  async save(item: CatalogItem): Promise<void> {
    this.items.set(item.id, item);
  }

  async findAllForTenant(tenantId: string): Promise<CatalogItem[]> {
    return [...this.items.values()].filter((i) => i.tenantId === tenantId);
  }

  async findById(tenantId: string, id: string): Promise<CatalogItem | null> {
    const item = this.items.get(id);
    return item && item.tenantId === tenantId ? item : null;
  }
}

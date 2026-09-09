import { KpiBenchmark, KpiBenchmarkStore } from "./kpi-benchmark.service";

export class InMemoryKpiBenchmarkStore implements KpiBenchmarkStore {
  private readonly benchmarks = new Map<string, KpiBenchmark>();

  async save(benchmark: KpiBenchmark): Promise<void> {
    this.benchmarks.set(benchmark.id, benchmark);
  }

  async findAllActiveForTenant(tenantId: string): Promise<KpiBenchmark[]> {
    return [...this.benchmarks.values()].filter((b) => b.tenantId === tenantId && b.isActive);
  }
}

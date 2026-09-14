import { Pool } from "pg";
import { KpiBenchmark, KpiBenchmarkStore, BenchmarkKpi, BenchmarkComparison, BenchmarkCadence } from "./kpi-benchmark.service";
import { runWithTenantContext } from "../../common/postgres";

interface KpiBenchmarkRow {
  id: string;
  tenant_id: string;
  user_id: string | null;
  kpi: BenchmarkKpi;
  comparison: BenchmarkComparison;
  threshold_value: string;
  cadence: BenchmarkCadence;
  period_start: Date;
  period_end: Date;
  is_active: boolean;
  created_at: Date;
}

function rowToBenchmark(row: KpiBenchmarkRow): KpiBenchmark {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    userId: row.user_id ?? undefined,
    kpi: row.kpi,
    comparison: row.comparison,
    thresholdValue: Number(row.threshold_value),
    cadence: row.cadence,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    isActive: row.is_active,
    createdAt: row.created_at,
  };
}

/** Real Postgres-backed KpiBenchmarkStore, against `kpi_benchmark`
 * (db/migrations/0011_kpi_benchmark.sql). */
export class PgKpiBenchmarkStore implements KpiBenchmarkStore {
  constructor(private readonly pool: Pool) {}

  async save(benchmark: KpiBenchmark): Promise<void> {
    await runWithTenantContext(this.pool, benchmark.tenantId, (client) =>
      client.query(
        `insert into kpi_benchmark (id, tenant_id, user_id, kpi, comparison, threshold_value, cadence, period_start, period_end, is_active)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          benchmark.id,
          benchmark.tenantId,
          benchmark.userId ?? null,
          benchmark.kpi,
          benchmark.comparison,
          benchmark.thresholdValue,
          benchmark.cadence,
          benchmark.periodStart,
          benchmark.periodEnd,
          benchmark.isActive,
        ]
      )
    );
  }

  async findAllActiveForTenant(tenantId: string): Promise<KpiBenchmark[]> {
    const result = await runWithTenantContext(this.pool, tenantId, (client) =>
      client.query<KpiBenchmarkRow>(`select * from kpi_benchmark where tenant_id = $1 and is_active = true order by period_start asc`, [tenantId])
    );
    return result.rows.map(rowToBenchmark);
  }
}

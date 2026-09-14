-- Mytrima — Migration 0039: KPI benchmark cadence + Rating/NPS as benchmarkable KPIs
-- Tenant's own explicit request (2026-09-15): "targets must be set for
-- daily and continues" (a cadence, not just a fixed custom period) and
-- "Rating 5, NPS 10" as two more benchmarkable KPIs alongside the existing
-- Sales ones (conversion rate/churn already existed but gain % validation
-- at the application layer — see kpi-benchmark.service.ts's KPI_UNIT).

begin;

alter table kpi_benchmark
  drop constraint kpi_benchmark_kpi_check;

alter table kpi_benchmark
  add constraint kpi_benchmark_kpi_check check (kpi in (
    'sales_amount', 'conversion_rate', 'avg_transaction_value',
    'units_per_transaction', 'transactional_volume', 'addon_rate',
    'churn_rate', 'average_rating', 'nps_score'
  ));

-- 'custom' = the original, unchanged behavior (a fixed period_start/
-- period_end the tenant sets once). 'daily'/'continuous' re-scope the
-- window every time the benchmark is checked — see
-- kpi-benchmark.service.ts's resolveCheckPeriod(). period_start/period_end
-- stay NOT NULL either way (a real value is always stored, even though a
-- non-custom cadence re-derives the window it actually checks against).
alter table kpi_benchmark
  add column cadence text not null default 'custom' check (cadence in ('custom', 'daily', 'continuous'));

commit;

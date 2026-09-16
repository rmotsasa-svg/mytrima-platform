-- Mytrima — Migration 0045: goal metric type
--
-- "Auto-suggest the real KPI value when updating a Goal" — the tenant's own
-- explicit request from the 360 assessment (P1.1). Optional: a goal can
-- still track something this platform doesn't compute a KPI for (left
-- null — no auto-suggest possible for it, an honest limitation rather than
-- a guess). See goal.service.ts's GoalMetricType comment for the exact set
-- and what each one names in SaleService.computeKpis().

begin;

alter table goal add column metric_type text
  check (metric_type in ('sales_amount', 'conversion_rate', 'churn_rate', 'average_rating', 'nps_score'));

commit;

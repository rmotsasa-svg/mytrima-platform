-- Mytrima — Migration 0011: KPI benchmarks
-- Per Master Plan Addendum v1.3, Section E ("KPI benchmarks & automated
-- alerts"): a fourth Automation & Notification Engine trigger, alongside the
-- three that already exist (Growth Audit bands, NPS detractors, moderated
-- ratings). Generalizes sales_target (0009) to every Sales KPI, not just
-- sales amount, so a new KPI doesn't need a new table.
--
-- Scoped decision (per the addendum): applies to Sales KPIs only — Growth
-- Audit's bands and NPS's detractor threshold are untouched, proven, tested
-- logic. No industry-benchmark defaults are seeded here — every threshold
-- is tenant-set (see the addendum's own "Needs verification" flag on
-- industry figures: no real cited source exists yet, and this project does
-- not ship fabricated numbers).

begin;

create table kpi_benchmark (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references tenant(id) on delete cascade,
  -- NULL = a tenant-level benchmark; a specific app_user id = per-staff,
  -- meaningful only for staff-attributable KPIs (sales_amount).
  user_id           uuid references app_user(id) on delete cascade,
  kpi               text not null check (kpi in (
                      'sales_amount', 'conversion_rate', 'avg_transaction_value',
                      'units_per_transaction', 'transactional_volume', 'addon_rate'
                    )),
  comparison        text not null check (comparison in ('above', 'below')),
  threshold_value    numeric(12,4) not null,
  -- timestamptz, not date — same real bug and fix as sales_target (0009):
  -- a `date` column truncates to midnight on round-trip, silently discarding
  -- any period narrower than a full calendar day, including "the last hour"
  -- windows this table's own daily check job uses in its tests.
  period_start      timestamptz not null,
  period_end        timestamptz not null,
  is_active         boolean not null default true,
  created_at        timestamptz not null default now(),
  check (period_end >= period_start)
);

alter table kpi_benchmark enable row level security;

create policy tenant_isolation_kpi_benchmark on kpi_benchmark
  using (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  with check (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

commit;

-- ---------------------------------------------------------------------------
-- REAL FINDING while applying 0007-0011 to this project's local database:
-- mytrima_app (the app's own runtime role) has no CREATE privilege on schema
-- public — Postgres 15+ revoked PUBLIC's default CREATE grant on that schema,
-- so all migrations (0001 onward) have only ever actually been run as the
-- postgres superuser, never as mytrima_app. That was already true before this
-- migration; it just had never been exercised with a brand-new migration file
-- since 0006. Confirmed separately: mytrima_app also had NO select/insert/
-- update/delete grant on these five new tables (0007-0011) immediately after
-- creation — the original grant in 0001's own setup only covered tables that
-- existed at the time it ran, not future ones. Fixed for this database with:
--   grant select, insert, update, delete on all tables in schema public to mytrima_app;
--   alter default privileges in schema public grant select, insert, update, delete on tables to mytrima_app;
-- The second line makes every FUTURE migration's tables grant automatically —
-- run once per real database (local dev, CI, staging, production), not per
-- migration file. CI's own db-rls-negative-tests job creates its Postgres
-- role fresh each run with an explicit grant already in .github/workflows/ci.yml,
-- so it was never exposed to this gap; a local database set up before this
-- finding will need the two statements above run once, by hand, as a superuser.
-- ---------------------------------------------------------------------------

-- Mytrima — Migration 0009: Sales, line items, and sales targets
-- Per Master Plan Addendum v1.3, Section E: the six KPIs a tenant asked to
-- monitor (conversion rate, sales-vs-target, units per transaction,
-- transactional volume, add-ons, average transaction value) are all computed
-- from the tables below — nothing here stores a pre-aggregated number.
--
-- customer_id and recorded_by_user_id are both nullable on purpose:
-- customer_id because a walk-in cash sale has no CRM record to attach to;
-- recorded_by_user_id because an imported (CSV) row has no app-user author.
-- source distinguishes the two ingestion paths named in the addendum's
-- phased build sequence (manual entry now, CSV import now, a named/verified
-- POS vendor's live sync deferred).

begin;

create table sale_transaction (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references tenant(id) on delete cascade,
  customer_id           uuid references customer(id) on delete set null,
  recorded_by_user_id   uuid references app_user(id) on delete set null,
  source                text not null default 'manual' check (source in ('manual', 'imported')),
  occurred_at           timestamptz not null default now(),
  subtotal_amount       numeric(12,2) not null check (subtotal_amount >= 0),
  discount_amount       numeric(12,2) not null default 0 check (discount_amount >= 0),
  total_amount          numeric(12,2) not null check (total_amount >= 0),
  deal_id               uuid references deal(id) on delete set null,
  created_at            timestamptz not null default now()
);

create table sale_transaction_line_item (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references tenant(id) on delete cascade,
  sale_transaction_id   uuid not null references sale_transaction(id) on delete cascade,
  catalog_item_id       uuid references catalog_item(id) on delete set null,
  description           text,
  quantity              numeric(10,2) not null check (quantity > 0),
  unit_price            numeric(12,2) not null check (unit_price >= 0),
  is_addon              boolean not null default false,
  -- A line item needs either a real catalog item or a free-text description —
  -- a manually-entered sale of something not yet in the catalog must still
  -- be recordable, per the catalog module's own minimal-scope decision.
  check (catalog_item_id is not null or description is not null)
);

create table sales_target (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references tenant(id) on delete cascade,
  -- NULL = a tenant-level target; a specific app_user id = a per-staff target.
  -- Generalizing to one nullable-scope column rather than two separate
  -- tables, per the addendum's own reasoning for kpi_benchmark (0011).
  user_id           uuid references app_user(id) on delete cascade,
  -- timestamptz, not date: a real bug caught running KpiBenchmarkCheckService
  -- against this database — a `date` column silently truncates to midnight
  -- on round-trip, so any period narrower than a full calendar day (e.g. "the
  -- last hour," used by the daily benchmark-check job itself) loses every
  -- sale that occurred after midnight. timestamptz supports calendar-day
  -- periods just as well (00:00:00 to 23:59:59) while also supporting finer
  -- ones, at no cost.
  period_start      timestamptz not null,
  period_end        timestamptz not null,
  target_amount     numeric(12,2) not null check (target_amount >= 0),
  created_at        timestamptz not null default now(),
  check (period_end >= period_start)
);

alter table sale_transaction            enable row level security;
alter table sale_transaction_line_item  enable row level security;
alter table sales_target                enable row level security;

create policy tenant_isolation_sale_transaction on sale_transaction
  using (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  with check (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

create policy tenant_isolation_sale_transaction_line_item on sale_transaction_line_item
  using (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  with check (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

create policy tenant_isolation_sales_target on sales_target
  using (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  with check (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

commit;

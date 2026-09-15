-- Mytrima — Migration 0042: staff commission rates
-- "Add staff commission module" — the tenant's own explicit request
-- (2026-09-15). One active rate per staff member — see
-- commission.service.ts's own top comment for why this is deliberately
-- not a rate-history table.

begin;

create table commission_rate (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenant(id) on delete cascade,
  user_id       uuid not null references app_user(id) on delete cascade,
  rate_percent  numeric(5,2) not null check (rate_percent >= 0 and rate_percent <= 100),
  created_at    timestamptz not null default now(),
  unique (tenant_id, user_id)
);

alter table commission_rate enable row level security;

create policy tenant_isolation_commission_rate on commission_rate
  using (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  with check (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

commit;

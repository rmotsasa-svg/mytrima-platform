-- Mytrima — Migration 0010: Vendors & petty cash
-- Per Master Plan Addendum v1.3, Section G: cash going OUT to a tenant's own
-- suppliers — a distinct concern from sales (cash coming in). A single
-- running ledger, not double-entry bookkeeping — right-sized to what a
-- 5-10-tenant pilot's petty cash drawer actually needs. No reconciliation
-- automation is built here (Default applied in the addendum): the ledger
-- itself is the whole feature until a real reconciliation workflow is
-- actually requested.

begin;

create table vendor (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenant(id) on delete cascade,
  name          text not null,
  contact_info  text,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now()
);

create table petty_cash_transaction (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references tenant(id) on delete cascade,
  -- NULL vendor_id = a float replenishment (cash added to the drawer, not
  -- paid to anyone); a real vendor_id = a payment made to that vendor.
  vendor_id             uuid references vendor(id) on delete set null,
  type                  text not null check (type in ('replenishment', 'vendor_payment')),
  amount                numeric(12,2) not null check (amount > 0),
  description           text,
  recorded_by_user_id   uuid references app_user(id) on delete set null,
  occurred_at           timestamptz not null default now(),
  -- A vendor_payment should name who was paid; a replenishment has no vendor.
  check (
    (type = 'vendor_payment' and vendor_id is not null) or
    (type = 'replenishment' and vendor_id is null)
  )
);

alter table vendor                 enable row level security;
alter table petty_cash_transaction enable row level security;

create policy tenant_isolation_vendor on vendor
  using (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  with check (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

create policy tenant_isolation_petty_cash_transaction on petty_cash_transaction
  using (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  with check (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

commit;

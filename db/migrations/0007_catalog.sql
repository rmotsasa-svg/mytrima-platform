-- Mytrima — Migration 0007: Product/Service catalog
-- Per Master Plan Addendum v1.3, Section D: a tenant's own maintained list of
-- what it sells — the prerequisite both the Sales module (0009) and the Deals
-- module (0008) are built on. Deliberately minimal: no stock/quantity-on-hand
-- tracking is included here — that is a materially different, unrequested
-- feature (reorder points, stock reconciliation) and stays out of scope until
-- actually asked for, same "no invented capabilities" discipline as every
-- other module in this codebase.

begin;

create table catalog_item (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenant(id) on delete cascade,
  name          text not null,
  item_type     text not null check (item_type in ('product', 'service')),
  sku           text,
  unit_price    numeric(12,2) not null check (unit_price >= 0),
  is_active     boolean not null default true,
  created_at    timestamptz not null default now()
);

alter table catalog_item enable row level security;

create policy tenant_isolation_catalog_item on catalog_item
  using (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  with check (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

commit;

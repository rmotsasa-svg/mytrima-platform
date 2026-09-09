-- Mytrima — Migration 0008: Deals & promotions
-- Per Master Plan Addendum v1.3, Section F: a standalone offer catalog that a
-- sale transaction (0009) can optionally apply — listable and manageable on
-- its own (e.g. for WhatsApp/marketing display) whether or not any sale has
-- ever used it. One generalized discount_type model rather than a separate
-- table per promotion pattern, so a new promo shape doesn't need a schema
-- change.
--
-- deal_catalog_item carries its own tenant_id (denormalized from deal),
-- rather than relying on a join through deal_id for tenant isolation — every
-- RLS-protected table in this codebase carries tenant_id directly (see
-- src/common/postgres.ts's own reasoning): a plain query joined through
-- another table's RLS is exactly the kind of indirection this project has
-- deliberately avoided everywhere else.

begin;

create table deal (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references tenant(id) on delete cascade,
  name              text not null,
  discount_type     text not null check (discount_type in ('percentage_off', 'buy_x_get_y_free', 'fixed_amount_off')),
  percentage_off    numeric(5,2) check (percentage_off is null or (percentage_off > 0 and percentage_off <= 100)),
  buy_quantity      integer check (buy_quantity is null or buy_quantity > 0),
  free_quantity     integer check (free_quantity is null or free_quantity > 0),
  fixed_amount_off  numeric(12,2) check (fixed_amount_off is null or fixed_amount_off >= 0),
  starts_at         timestamptz,
  ends_at           timestamptz,
  is_active         boolean not null default true,
  created_at        timestamptz not null default now()
);

create table deal_catalog_item (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references tenant(id) on delete cascade,
  deal_id           uuid not null references deal(id) on delete cascade,
  catalog_item_id   uuid not null references catalog_item(id) on delete cascade,
  unique (deal_id, catalog_item_id)
);

alter table deal              enable row level security;
alter table deal_catalog_item enable row level security;

create policy tenant_isolation_deal on deal
  using (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  with check (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

create policy tenant_isolation_deal_catalog_item on deal_catalog_item
  using (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  with check (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

commit;

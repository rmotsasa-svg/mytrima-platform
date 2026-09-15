-- Mytrima — Migration 0043: quotation module
-- "Let's add a quotation module" — the tenant's own explicit request
-- (2026-09-16). Same shape as sale_transaction/sale_transaction_line_item
-- (0009_sales.sql) and deal/deal_catalog_item (0008_deals.sql): a header
-- row plus a real child line-item table, both RLS-protected.

begin;

create table quotation (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references tenant(id) on delete cascade,
  -- "QUO-0001" — see quotation.service.ts's own formatQuoteNumber()
  -- comment for exactly how this is generated and its one disclosed
  -- limitation. Unique per tenant, not globally — two different tenants
  -- each legitimately have their own "QUO-0001".
  quote_number        text not null,
  -- on delete set null, not cascade: a customer record being deleted
  -- later must never delete a real quotation that was once sent to them,
  -- only lose the link — same reasoning as customer.created_by_user_id.
  customer_id         uuid references customer(id) on delete set null,
  subtotal_amount     numeric(12,2) not null,
  discount_amount     numeric(12,2) not null default 0,
  total_amount        numeric(12,2) not null,
  notes               text,
  valid_until         timestamptz,
  status              text not null default 'draft' check (status in ('draft', 'sent')),
  created_by_user_id  uuid references app_user(id) on delete set null,
  created_at          timestamptz not null default now(),
  sent_at             timestamptz,
  unique (tenant_id, quote_number)
);

create table quotation_line_item (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references tenant(id) on delete cascade,
  quotation_id     uuid not null references quotation(id) on delete cascade,
  catalog_item_id  uuid references catalog_item(id) on delete set null,
  description      text,
  quantity         numeric(10,2) not null check (quantity > 0),
  unit_price       numeric(12,2) not null check (unit_price >= 0),
  -- Same real rule as sale_transaction_line_item: a line item needs
  -- either a real catalog item or a free-text description.
  check (catalog_item_id is not null or description is not null)
);

alter table quotation enable row level security;
alter table quotation_line_item enable row level security;

create policy tenant_isolation_quotation on quotation
  using (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  with check (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

create policy tenant_isolation_quotation_line_item on quotation_line_item
  using (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  with check (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

commit;

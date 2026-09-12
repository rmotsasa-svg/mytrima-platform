-- Mytrima — Migration 0028: sale_refund
--
-- REAL GAP closed 2026-09-12, at the tenant's own explicit request: the
-- P.O.S. (formerly "Sales") page needed to process refunds and exchanges,
-- and nothing in this schema recorded a refund at all. One real row per
-- refund event — a customer returning three of five units sold in a
-- transaction is one row, not three — with `line_items` holding exactly
-- which catalog item(s)/quantities were returned, mirroring how
-- sale_transaction_line_item itself already records a sale's own lines,
-- just denormalized into jsonb here rather than a child table: a refund's
-- line items are never independently queried/joined the way a sale's own
-- lines are (by product-contribution reporting, for one), so a full child
-- table would add real schema weight for no real query this app performs.
--
-- Deliberately does NOT model "exchange" as its own concept: an exchange
-- is a refund of the returned item(s) plus an ordinary new sale for the
-- replacement item(s) — see refund.service.ts's own top comment for why
-- composing two already-real primitives is preferred over inventing a
-- third one nothing else in this schema would need to know about.

begin;

create table sale_refund (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant(id) on delete cascade,
  sale_id uuid not null references sale_transaction(id) on delete cascade,
  reason text,
  refund_amount numeric(12, 2) not null,
  line_items jsonb not null,
  recorded_by_user_id uuid,
  created_at timestamptz not null default now()
);

create index sale_refund_tenant_sale_idx on sale_refund (tenant_id, sale_id);
create index sale_refund_tenant_time_idx on sale_refund (tenant_id, created_at desc);

alter table sale_refund enable row level security;

create policy tenant_isolation_sale_refund on sale_refund
  using (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  with check (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

commit;

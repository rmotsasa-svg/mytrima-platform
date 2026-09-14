-- Mytrima — Migration 0031: sale payment_method, and daily shift-end
-- banking for the P.O.S.
--
-- REAL GAP closed 2026-09-14, at the tenant's own explicit request ("allow
-- staff to do daily shift end banking"). Before this, no sale anywhere in
-- this schema recorded HOW a customer paid — there was no honest way to
-- compute "how much cash should be in the till right now" from real sales
-- data, which any real shift-end cash-up needs. `payment_method` on
-- sale_transaction closes that; `shift_banking` is the real reconciliation
-- record itself — see sale.service.ts's own PaymentMethod comment and
-- shift-banking.service.ts's own top comment for exactly what each field
-- means and the one disclosed simplification (refunds net against
-- expected cash regardless of the refunded sale's own payment method,
-- same assumption SalesController's own netSalesAmount already makes).

begin;

alter table sale_transaction add column payment_method text not null default 'cash'
  check (payment_method in ('cash', 'card', 'mobile_money', 'other'));

create table shift_banking (
  id                      uuid primary key default gen_random_uuid(),
  tenant_id               uuid not null references tenant(id) on delete cascade,
  period_start            timestamptz not null,
  period_end              timestamptz not null,
  -- Snapshotted at record time, not recomputed later — a real cash-up
  -- record is a point-in-time reconciliation, same reasoning a paper till
  -- slip is never silently rewritten after the fact.
  expected_cash_amount    numeric(12, 2) not null,
  counted_cash_amount     numeric(12, 2) not null check (counted_cash_amount >= 0),
  banked_amount           numeric(12, 2) not null check (banked_amount >= 0),
  notes                   text,
  recorded_by_user_id     uuid references app_user(id) on delete set null,
  created_at              timestamptz not null default now()
);

create index shift_banking_tenant_time_idx on shift_banking (tenant_id, created_at desc);

alter table shift_banking enable row level security;

create policy tenant_isolation_shift_banking on shift_banking
  using (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  with check (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

commit;

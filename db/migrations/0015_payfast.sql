-- Mytrima — Migration 0015: PayFast merchant-of-record payments
-- Backs the real PayFast Split Payments flow (src/modules/integrations/payments/
-- payfast.service.ts) per the merchant-of-record decision confirmed 2026-09-10
-- (Master Plan Section 17): Mytrima collects payments on Tenants' behalf via a
-- single Mytrima PayFast account, instantly splitting each Tenant's share to
-- that Tenant's own PayFast merchant account.

begin;

-- Each Tenant needs their own PayFast merchant account to receive a split —
-- see payfast.service.ts's own top comment. Nullable: a Tenant who hasn't
-- provided theirs yet can't check out through this flow, a real, expected
-- state to fail loudly on, not an error condition to guess around.
alter table tenant add column payfast_merchant_id text;

-- A real, minimal audit trail of every ITN this platform has genuinely
-- received and verified (signature check + PayFast's own server-to-server
-- confirmation — see PayFastService.verifyItnSignature()/confirmWithPayFastServer()).
-- Deliberately NOT an order/invoice/fulfillment table — no such model exists
-- yet anywhere in this codebase to attach a payment outcome to (the Sales
-- module's sale_transaction has no PayFast reference), so this stays exactly
-- what it honestly is: proof a real, verified notification was received, not
-- an invented "payment marks something else paid" business process.
create table payfast_itn_log (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references tenant(id) on delete cascade,
  m_payment_id      text not null,
  pf_payment_id     text not null,
  payment_status    text not null,
  amount_gross      numeric(12,2),
  signature_valid   boolean not null,
  server_confirmed  boolean not null,
  raw_payload       jsonb not null,
  received_at       timestamptz not null default now()
);

alter table payfast_itn_log enable row level security;

create policy tenant_isolation_payfast_itn_log on payfast_itn_log
  using (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  with check (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

commit;

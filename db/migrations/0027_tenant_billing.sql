-- Mytrima — Migration 0027: tenant_subscription, subscription_payment
--
-- REAL GAP closed 2026-09-12, following the SPA feature-spec assessment's
-- own "Subscription/Bills" finding: there was no concept anywhere of
-- Mytrima billing a TENANT for using the platform — the Packages page on
-- the public landing site (landing/src/pages/PackagesPage.tsx) has real
-- prices, but nothing paired one with an actual tenant account. The
-- tenant's own decision, made explicitly: collect these payments via
-- MoPay (src/modules/integrations/payments/mopay.service.ts) — a fully
-- live-verified client (real sandbox create->pay->verify flow proven,
-- fees confirmed by the vendor) that had never been wired to any real
-- business flow before this.
--
-- Deliberately does NOT add any feature-gating/access-enforcement based on
-- subscription status — this migration and the module built on it are
-- record-keeping (what package is a tenant on, what have they paid) plus
-- a real MoPay checkout, not an access-control system. tenant.status stays
-- exactly as decorative as the 2026-09-12 security assessment found it;
-- locking a tenant out of their own account for non-payment is a real,
-- separate, higher-stakes decision nobody has asked for yet.

begin;

create table tenant_subscription (
  tenant_id            uuid primary key references tenant(id) on delete cascade,
  package              text not null default 'Start Free',
  status               text not null default 'active' check (status in ('active', 'inactive')),
  current_period_start timestamptz,
  current_period_end   timestamptz,
  updated_at           timestamptz not null default now()
);

alter table tenant_subscription enable row level security;

create policy tenant_isolation_tenant_subscription on tenant_subscription
  using (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  with check (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- A real, queryable payment history — one row per MoPay checkout attempt,
-- same "record every attempt, not just successes" reasoning as
-- payfast_itn_log (0015_payfast.sql's own precedent).
create table subscription_payment (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references tenant(id) on delete cascade,
  package          text not null,
  amount           numeric(12, 2) not null,
  mopay_session_id text not null,
  mopay_reference  text not null,
  status           text not null default 'created' check (status in ('created', 'completed', 'failed', 'cancelled')),
  created_at       timestamptz not null default now(),
  completed_at     timestamptz
);

create index subscription_payment_tenant_time_idx on subscription_payment (tenant_id, created_at desc);

alter table subscription_payment enable row level security;

create policy tenant_isolation_subscription_payment on subscription_payment
  using (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  with check (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

commit;

-- Mytrima — Migration 0048: tenant subscription billing
--
-- B2 of "ACTION PROPOSED ADDITIONS IN PRIORITY ORDER" — "use MoPay to
-- collect mytrima payments when tenants register on Mytrima", following
-- the real tiers/prices already published on the landing site's own
-- Packages page (landing/src/pages/PackagesPage.tsx): Pro Plus (R350),
-- Growth Plan (R420), Growth Partner (R600), all ZAR/month, plus the
-- existing real Free tier ("no card required to start"). See
-- billing/subscription.service.ts's own TIER_PRICING_ZAR comment for why
-- that file, not a second hardcoded copy here, is the one source of truth
-- for the actual amounts.

begin;

alter table tenant add column subscription_tier text not null default 'free'
  check (subscription_tier in ('free', 'pro_plus', 'growth_plan', 'growth_partner'));
alter table tenant add column subscription_status text not null default 'active'
  check (subscription_status in ('active', 'pending_payment', 'past_due'));
alter table tenant add column next_billing_date timestamptz;

-- Real audit trail of every subscription charge attempt — mirrors
-- payfast_itn_log's own role for the B1 checkout flow, but for Mytrima's
-- OWN platform-level MoPay account collecting FROM a tenant, the reverse
-- direction from B1's tenant-owned mopay_api_key collecting from a
-- tenant's own customers.
create table tenant_subscription_payment (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references tenant(id) on delete cascade,
  tier               text not null check (tier in ('pro_plus', 'growth_plan', 'growth_partner')),
  amount_zar         numeric not null,
  mopay_session_id   text not null,
  mopay_reference    text not null,
  status             text not null default 'pending' check (status in ('pending', 'paid', 'failed')),
  created_at         timestamptz not null default now(),
  paid_at            timestamptz
);

create index tenant_subscription_payment_tenant_idx on tenant_subscription_payment (tenant_id, created_at desc);
create unique index tenant_subscription_payment_pending_idx on tenant_subscription_payment (tenant_id) where status = 'pending';

alter table tenant_subscription_payment enable row level security;

create policy tenant_isolation_tenant_subscription_payment on tenant_subscription_payment
  using (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  with check (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

commit;

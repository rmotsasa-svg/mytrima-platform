-- Mytrima — Migration 0037: CRM (leads + pipeline activity)
--
-- Phase 5 of the GrowthOS-aligned restructuring plan
-- (C:\Users\USER\.claude\plans\twinkly-sprouting-orbit.md) — confirmed
-- during the plan's own analysis phase to be the single biggest real gap
-- in this codebase: no lead/opportunity/pipeline concept existed anywhere
-- before this migration. `deal` (0008_deals.sql) is an unrelated
-- discount/promotion catalog; `customer` (0001) is post-sale record-
-- keeping only.
--
-- Two tables, not one: `lead` (the pipeline record itself) and
-- `crm_activity` (its append-only interaction log) are deliberately
-- separate — see crm.service.ts's own CrmActivityStore comment for why a
-- growing timeline must never be a rewritten child array the way
-- `deal_catalog_item` (0008) is.

begin;

create table lead (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references tenant(id) on delete cascade,
  name              text not null,
  contact_phone     text,
  contact_email     text,
  source            text not null,
  stage             text not null default 'new' check (stage in ('new', 'qualified', 'proposal', 'negotiation', 'won', 'lost')),
  estimated_value   numeric,
  owner_user_id     uuid references app_user(id) on delete set null,
  created_at        timestamptz not null default now(),
  last_activity_at  timestamptz not null default now(),
  -- Set once a lead is won — see Lead.wonCustomerId's own comment
  -- (crm.service.ts) on why this never unsets once genuinely won.
  won_customer_id   uuid references customer(id) on delete set null
);

create index lead_tenant_stage_idx on lead (tenant_id, stage, last_activity_at desc);

alter table lead enable row level security;

create policy tenant_isolation_lead on lead
  using (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  with check (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

create table crm_activity (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references tenant(id) on delete cascade,
  lead_id             uuid not null references lead(id) on delete cascade,
  type                text not null check (type in ('note', 'call', 'whatsapp', 'meeting')),
  body                text not null,
  created_at          timestamptz not null default now(),
  created_by_user_id  uuid not null references app_user(id) on delete cascade
);

create index crm_activity_lead_time_idx on crm_activity (tenant_id, lead_id, created_at desc);

alter table crm_activity enable row level security;

create policy tenant_isolation_crm_activity on crm_activity
  using (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  with check (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

commit;

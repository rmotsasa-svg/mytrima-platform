-- Mytrima — Migration 0032: marketing campaigns
--
-- REAL GAP closed 2026-09-14, at the tenant's own explicit request ("add
-- campaign set for Facebook, WhatsApp, Instagram and Website"). A campaign
-- is a real, named, multi-channel promotional push — optionally reusing an
-- existing Deal's own content (name/discount copy/ad image) rather than
-- inventing a second content model — with its own real launch history. See
-- campaign.service.ts's own top comment for exactly what "launching" each
-- channel does and does not do yet (the website channel is a disclosed,
-- real, not-yet-wired-up gap: a trackable link is generated, but click
-- attribution isn't fed back into analytics yet).

begin;

create table campaign (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references tenant(id) on delete cascade,
  name                  text not null,
  deal_id               uuid references deal(id) on delete set null,
  message               text,
  channels              text[] not null,
  last_launched_at      timestamptz,
  last_launch_results   jsonb,
  created_at            timestamptz not null default now()
);

create index campaign_tenant_time_idx on campaign (tenant_id, created_at desc);

alter table campaign enable row level security;

create policy tenant_isolation_campaign on campaign
  using (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  with check (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

commit;

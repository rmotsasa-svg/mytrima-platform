-- Mytrima — Migration 0034: persisted triggers
--
-- Phase 2 of the GrowthOS-aligned restructuring plan
-- (C:\Users\USER\.claude\plans\twinkly-sprouting-orbit.md). The real
-- trigger-detection logic in automation.service.ts (notificationsFor*())
-- has existed since early in this project, but a NotificationEvent it
-- produced was only ever enqueued for a WhatsApp send and then forgotten —
-- nothing stored it, so a tenant could never open a list of "what has this
-- platform flagged for me" or mark one resolved. This table is that list.

begin;

create table trigger (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references tenant(id) on delete cascade,
  type               text not null,
  severity           text not null check (severity in ('critical', 'warning', 'info')),
  message            text not null,
  about_customer_id  uuid references customer(id) on delete set null,
  source_module      text not null,
  created_at         timestamptz not null default now(),
  status             text not null default 'open' check (status in ('open', 'actioned', 'dismissed')),
  actioned_at        timestamptz
);

create index trigger_tenant_status_idx on trigger (tenant_id, status, created_at desc);

alter table trigger enable row level security;

create policy tenant_isolation_trigger on trigger
  using (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  with check (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

commit;

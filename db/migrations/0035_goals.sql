-- Mytrima — Migration 0035: goals
--
-- Phase 3 of the GrowthOS-aligned restructuring plan
-- (C:\Users\USER\.claude\plans\twinkly-sprouting-orbit.md). Replaces
-- tenant.business_goal (a single free-text field, see tenant.service.ts's
-- own comment on why it could never drive anything real) with real,
-- measurable, tracked goals — a business can have several at once, each
-- with a real baseline/target/deadline a progress bar is actually computed
-- from (see goal.service.ts's computeProgressPct()). tenant.business_goal
-- itself is left in place, unwritten by anything from this point on — not
-- worth a data-migration for a field that was never structured enough to
-- migrate meaningfully.

begin;

create table goal (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references tenant(id) on delete cascade,
  objective      text not null,
  metric         text not null,
  baseline_value numeric not null,
  current_value  numeric not null,
  target_value   numeric not null,
  deadline       timestamptz not null,
  owner_user_id  uuid references app_user(id) on delete set null,
  priority       text not null check (priority in ('low', 'medium', 'high')),
  status         text not null default 'on_track' check (status in ('on_track', 'at_risk', 'achieved', 'abandoned')),
  created_at     timestamptz not null default now()
);

create index goal_tenant_deadline_idx on goal (tenant_id, deadline asc);

alter table goal enable row level security;

create policy tenant_isolation_goal on goal
  using (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  with check (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

commit;

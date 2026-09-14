-- Mytrima — Migration 0036: growth actions
--
-- Phase 4 of the GrowthOS-aligned restructuring plan
-- (C:\Users\USER\.claude\plans\twinkly-sprouting-orbit.md). A real,
-- stateful task, distinct from GrowthActionsPage.tsx's (renamed from
-- TodaysTasksPage.tsx this phase) four existing DERIVED signals (booking
-- requests, pending ratings, NPS detractors, the audit action plan),
-- which need no table of their own — they're already real rows in other
-- tables. This table is for the different case: a task with a real
-- lifecycle, created manually or by converting a Trigger (see
-- growth_action.related_trigger_id and TriggerService.convertToAction()).

begin;

create table growth_action (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references tenant(id) on delete cascade,
  title               text not null,
  reason              text not null,
  priority            text not null check (priority in ('low', 'medium', 'high')),
  expected_impact     text not null,
  estimated_minutes   integer,
  due_date            timestamptz,
  owner_user_id       uuid references app_user(id) on delete set null,
  related_goal_id     uuid references goal(id) on delete set null,
  related_trigger_id  uuid references trigger(id) on delete set null,
  status              text not null default 'todo' check (status in ('todo', 'in_progress', 'done', 'dismissed')),
  result              text,
  created_at          timestamptz not null default now()
);

create index growth_action_tenant_status_idx on growth_action (tenant_id, status, created_at desc);

alter table growth_action enable row level security;

create policy tenant_isolation_growth_action on growth_action
  using (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  with check (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

commit;

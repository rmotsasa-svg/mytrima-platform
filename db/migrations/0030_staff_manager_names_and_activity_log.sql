-- Mytrima — Migration 0030: staff first/last name, a "manager" role, and a
-- real staff activity log.
--
-- REAL GAP closed 2026-09-14, at the tenant's own explicit request. Three
-- changes bundled together since all three are about the same "staff
-- module" concern:
--
--   1. app_user gains first_name/last_name — StaffPage.tsx has only ever
--      collected an email; the tenant asked directly to be able to record a
--      teammate's actual name. Both nullable: every account created before
--      this migration has neither, and this platform still functions with
--      just an email (falls back to it for display — see auth.service.ts's
--      own comment).
--   2. The role check constraint gains 'manager', between 'owner' and
--      'staff' in real privilege — see rbac.ts's own comment on exactly
--      which permissions move to it (petty cash and refund/exchange
--      authorization, per the tenant's own explicit request that "manager
--      must authorize petty cash and exchange").
--   3. staff_activity_log — a real, if intentionally narrow, audit trail.
--      Not a generic "log everything" table (a genuine scope decision, not
--      an oversight — see staff-activity.service.ts's own top comment for
--      exactly which real actions are logged and why only those).

begin;

alter table app_user add column first_name text;
alter table app_user add column last_name text;

alter table app_user drop constraint app_user_role_check;
alter table app_user add constraint app_user_role_check check (role in ('owner', 'manager', 'staff', 'read_only'));

create table staff_activity_log (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenant(id) on delete cascade,
  user_id       uuid not null references app_user(id) on delete cascade,
  action        text not null,
  details       jsonb,
  occurred_at   timestamptz not null default now()
);

create index staff_activity_log_tenant_time_idx on staff_activity_log (tenant_id, occurred_at desc);
create index staff_activity_log_tenant_user_idx on staff_activity_log (tenant_id, user_id, occurred_at desc);

alter table staff_activity_log enable row level security;

create policy tenant_isolation_staff_activity_log on staff_activity_log
  using (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  with check (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

commit;

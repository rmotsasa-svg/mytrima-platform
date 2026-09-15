-- Mytrima — Migration 0040: staff ID numbers
-- Tenant's own explicit request (2026-09-15): "create staff id numbers" —
-- a short, human-readable badge number ("STAFF-0001"), distinct from
-- app_user.id (a real uuid never shown to anyone). Sequential PER TENANT,
-- assigned once at AuthService.register() time (see that file's own
-- comment on the disclosed non-concurrency-safe limitation this has).

begin;

alter table app_user add column staff_id_number text;

-- Backfill every account created before this column existed, numbered by
-- each tenant's own real created_at order — the same ordering
-- AuthUserStore.findAllForTenant() already uses, so a backfilled account's
-- number matches what register() would have assigned it at the time.
with numbered as (
  select id, row_number() over (partition by tenant_id order by created_at asc) as seq
  from app_user
)
update app_user
set staff_id_number = 'STAFF-' || lpad(numbered.seq::text, 4, '0')
from numbered
where app_user.id = numbered.id;

alter table app_user alter column staff_id_number set not null;

-- Uniqueness scoped to (tenant_id, staff_id_number), not staff_id_number
-- alone — two different tenants each legitimately have their own
-- "STAFF-0001".
alter table app_user add constraint app_user_tenant_staff_id_number_unique unique (tenant_id, staff_id_number);

commit;

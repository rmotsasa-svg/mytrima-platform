-- Mytrima — Migration 0022: app_user.is_active
-- Backs the new Staff module (deactivate/reactivate a teammate's access
-- without deleting their history — sales they recorded, audits they
-- submitted stay correctly attributed to a real user id). Defaults true so
-- every existing account stays exactly as usable as it already was.

begin;

alter table app_user
  add column is_active boolean not null default true;

commit;

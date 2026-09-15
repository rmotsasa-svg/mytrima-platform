-- Mytrima — Migration 0041: link staff to customer create/update
--
-- Real gap closed 2026-09-15 at the tenant's own explicit request ("link
-- staff to ... customer update"). Both user-id columns nullable — every
-- customer created before this column existed has neither. `on delete set
-- null`, not `cascade`: a staff account being deactivated/removed later
-- must never delete the customer records they touched, only lose the
-- attribution.
--
-- updated_at added alongside: without a real timestamp, "which customers
-- were updated in period X" (staff performance) has no honest answer,
-- only "who most recently touched this record, whenever that was."
-- Backfilled to each existing row's own created_at — the honest answer
-- for "last known edit" on a row this migration has no real edit history
-- for, not a fabricated "just now."

begin;

alter table customer add column created_by_user_id uuid references app_user(id) on delete set null;
alter table customer add column updated_by_user_id uuid references app_user(id) on delete set null;
alter table customer add column updated_at timestamptz not null default now();
update customer set updated_at = created_at;

commit;

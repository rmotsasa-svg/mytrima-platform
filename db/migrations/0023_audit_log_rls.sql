-- Mytrima — Migration 0023: audit_log row-level security
-- Closes a real gap the Platform Readiness Assessment flagged: `audit_log`
-- (created in 0001_tenant_and_rls.sql per the Master Plan's own data model)
-- was the one table in this whole schema with no RLS policy at all —
-- harmless today (no application code anywhere writes or reads it yet; the
-- table is genuinely unused, not a live gap), but a real inconsistency
-- worth closing now rather than leaving as a trap for whenever real audit
-- logging is actually built and someone assumes every table here already
-- has RLS, since every other one does.
--
-- tenant_id is nullable (platform-level events have no tenant, per 0001's
-- own comment), so the policy's USING/WITH CHECK clause allows a null
-- tenant_id through unconditionally (a platform-level row is not any
-- tenant's to isolate) alongside the usual tenant match — the same shape
-- Postgres RLS needs whenever a column legitimately can be null.

begin;

alter table audit_log enable row level security;

create policy tenant_isolation_audit_log on audit_log
  using (tenant_id is null or tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  with check (tenant_id is null or tenant_id = current_setting('app.current_tenant_id', true)::uuid);

commit;

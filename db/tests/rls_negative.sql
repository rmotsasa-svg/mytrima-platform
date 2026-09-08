-- RLS Negative Test — automated (Master Plan v1.2, Section 9).
-- Supersedes the manual procedure in rls_negative.test.md as the thing that
-- actually runs; that file is kept for the rationale behind the WITH CHECK
-- gap this script was written to catch, now closed in 0001_tenant_and_rls.sql.
--
-- ACTUALLY EXECUTED — for real, against a real local PostgreSQL 17 instance,
-- with a genuine non-superuser mytrima_app role (not a superuser, which
-- would make every assertion below pass vacuously without RLS ever being
-- exercised). Result: "RLS negative test passed" — Tenant A's session saw
-- exactly its own row, could not see Tenant B's row, and a cross-tenant
-- INSERT attempt was genuinely rejected by the WITH CHECK clause. This is
-- the single most important security claim in this scaffold, and it is now
-- proven, not assumed. Still NOT executed against a real GitHub Actions
-- runner via .github/workflows/ci.yml's Postgres service container — confirm
-- that specific path goes green too before treating the CI job itself as
-- proven; the SQL it runs is now known-good independent of that.
--
-- Prerequisite this script assumes and does not create: a non-superuser
-- application role named `mytrima_app` with SELECT/INSERT on tenant, customer
-- (and no BYPASSRLS attribute). The CI job creates this role before running
-- this script; do the same manually first if running this by hand (see
-- README.md's "RLS: proven live" section for the exact command used).
--
-- Run manually against a real dev database with:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/tests/rls_negative.sql

begin;

-- 1. Seed two tenants and one customer row each.
insert into tenant (id, name) values
  ('11111111-1111-1111-1111-111111111111', 'Tenant A'),
  ('22222222-2222-2222-2222-222222222222', 'Tenant B');

insert into customer (tenant_id, display_name) values
  ('11111111-1111-1111-1111-111111111111', 'A''s customer'),
  ('22222222-2222-2222-2222-222222222222', 'B''s customer');

-- 2. Scope the session to Tenant A, as the application role (not a superuser
--    — RLS is bypassed for superusers and BYPASSRLS roles).
set role mytrima_app;
select set_config('app.current_tenant_id', '11111111-1111-1111-1111-111111111111', true);

-- 3. A Tenant-A-scoped session must see exactly its own row, never Tenant B's.
do $$
declare
  visible_count int;
  leaked_count  int;
begin
  select count(*) into visible_count from customer;
  if visible_count <> 1 then
    raise exception 'RLS FAILURE: Tenant A session sees % customer row(s), expected exactly 1', visible_count;
  end if;

  select count(*) into leaked_count from customer
    where tenant_id = '22222222-2222-2222-2222-222222222222';
  if leaked_count <> 0 then
    raise exception 'RLS FAILURE: Tenant A session can see % of Tenant B''s row(s) — the actual leak this policy exists to prevent', leaked_count;
  end if;
end $$;

-- 4. Attempt to INSERT a row claiming to belong to Tenant B while scoped to
--    Tenant A. This is the case the WITH CHECK clause (added in 0001) exists
--    to reject — a USING-only policy would have let this silently succeed.
do $$
begin
  begin
    insert into customer (tenant_id, display_name)
      values ('22222222-2222-2222-2222-222222222222', 'Should be rejected');
    raise exception 'RLS FAILURE: cross-tenant insert succeeded — WITH CHECK clause on tenant_isolation_customer did not fire';
  exception
    when insufficient_privilege then
      -- Expected: WITH CHECK rejects the row.
      null;
  end;
end $$;

rollback;

select 'RLS negative test passed' as result;

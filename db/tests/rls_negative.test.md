# RLS Negative Test — Original Manual Procedure (superseded)

**Status: superseded by an automated script.** Per Master Plan v1.2, this procedure has
been converted into `db/tests/rls_negative.sql`, wired into a Postgres service container
in `.github/workflows/ci.yml`. That script is what actually runs now — this file is kept
only for the rationale below. Neither the script nor the migration has been executed
against a live database or a real GitHub Actions runner in this environment (no Postgres
instance is available here); confirm the CI job actually goes green on the first real
pull request before treating it as a passing check.

## Procedure

```sql
-- 1. Seed two tenants and one row each
insert into tenant (id, name) values
  ('11111111-1111-1111-1111-111111111111', 'Tenant A'),
  ('22222222-2222-2222-2222-222222222222', 'Tenant B');

insert into customer (tenant_id, display_name) values
  ('11111111-1111-1111-1111-111111111111', 'A''s customer'),
  ('22222222-2222-2222-2222-222222222222', 'B''s customer');

-- 2. As the application role (NOT a superuser — RLS is bypassed for superusers
--    and roles with BYPASSRLS, which is itself something to verify the app's
--    DB role does not have), set the session to Tenant A and query customers.
set role mytrima_app;
select set_config('app.current_tenant_id', '11111111-1111-1111-1111-111111111111', true);

select count(*) from customer;
-- EXPECTED: 1 (only Tenant A's row)
-- FAIL CONDITION: 2 rows returned, or Tenant B's row visible in any form.

-- 3. Attempt to read Tenant B's data while scoped to Tenant A
select * from customer where tenant_id = '22222222-2222-2222-2222-222222222222';
-- EXPECTED: 0 rows.
-- FAIL CONDITION: any row returned — this is the actual leak this policy exists to prevent.

-- 4. Attempt to INSERT a row claiming to belong to Tenant B while scoped to Tenant A
insert into customer (tenant_id, display_name)
  values ('22222222-2222-2222-2222-222222222222', 'Should be rejected');
-- EXPECTED: insert fails RLS check (0 rows affected, or policy violation error
-- depending on whether a WITH CHECK clause is added — the migration above only
-- defines a USING clause; add a matching WITH CHECK clause before this is
-- considered complete, and re-run this step).
```

## Known gap in the original migration — now closed

The RLS policies in `0001_tenant_and_rls.sql` originally defined only `USING` clauses
(which govern what existing rows are visible), not matching `WITH CHECK` clauses (which
govern what new rows can be inserted/updated). **This was an intentional flag, not an
oversight left silent**: a `USING`-only policy can still allow a session to insert a row
for a different tenant_id than its own if the application forgets to set it correctly.
`WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid)` has since
been added to every policy in `0001_tenant_and_rls.sql`. Step 4 above — and its automated
equivalent in `db/tests/rls_negative.sql` — is what confirms that gap is actually closed,
not just edited.

## Also verify before Section 16 closes out

- Confirm the application's database role does **not** have `BYPASSRLS` — a role
  with that attribute skips every policy above silently.
- Confirm `app.current_tenant_id` is set inside the same transaction as every
  query (via `set_config(..., true)` — the `true` third argument scopes it to the
  transaction, not the whole connection, which matters under connection pooling).
- Load-test the session-variable approach under a real connection pool (e.g.
  PgBouncer in transaction mode) — session-scoped settings and connection pooling
  have known interaction pitfalls that need verifying with the actual pooler chosen.

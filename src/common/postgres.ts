import { Pool, PoolClient } from "pg";

/**
 * The one place tenant-scoped Postgres access happens for every
 * Pg*Store — every real query runs inside a transaction with
 * `app.current_tenant_id` set via `set_config(..., true)` (transaction-
 * scoped, not session-scoped) before the query, so PostgreSQL's own RLS
 * policies (0001_tenant_and_rls.sql) are what actually enforce tenant
 * isolation, not application code alone. This is the load-bearing piece
 * `db/tests/rls_negative.test.md` flagged as needing verification under a
 * real connection pool: "session-scoped settings and connection pooling
 * have known interaction pitfalls." Using a transaction-scoped
 * `set_config` (the `true` third argument) rather than a plain `SET`
 * (session-scoped) is exactly what avoids that pitfall — a pooled
 * connection handed back to `pool` after `client.release()` has no
 * leftover tenant context for the next borrower, because the transaction
 * that held it has already committed or rolled back.
 *
 * SUBTLE FOOTGUN, found only by actually hitting it while building a
 * genuine cross-tenant maintenance query (RevokedTokenCleanupService):
 * "no leftover tenant context" does NOT mean the connection behaves like a
 * pristine, never-used one afterward. Confirmed directly against this
 * project's own database: on a truly fresh connection,
 * current_setting('app.current_tenant_id', true) returns NULL — but once
 * ANY transaction on that connection has called set_config(...) even once,
 * the value after COMMIT reverts to an EMPTY STRING, not NULL. A plain
 * query against an RLS-protected table on such a (reused) connection then
 * evaluates ''::uuid in the policy and throws "invalid input syntax for
 * type uuid", rather than the "sees nothing" behavior a genuinely
 * NULL-valued setting would produce. Every store in this codebase is safe
 * from this because every query against an RLS-protected table always
 * goes through runWithTenantContext — there is no plain-query code path
 * that touches one of those tables directly. A deliberately cross-tenant
 * operation (deleting expired rows for every tenant, say) must NOT try to
 * bypass tenant context on a pooled connection for this reason — iterate
 * per-tenant instead, exactly like RevokedTokenCleanupService.deleteExpired()
 * does.
 *
 * ACTUALLY VERIFIED against a real local PostgreSQL 17 instance, under a
 * real pool reusing connections across different tenant contexts — see
 * postgres.test.ts. Gated behind TEST_DATABASE_URL so `npm test` stays
 * green on any machine without a Postgres instance available; run with it
 * set to actually exercise this against a live database.
 */
export function createPgPool(connectionString: string): Pool {
  return new Pool({ connectionString });
}

export async function runWithTenantContext<T>(pool: Pool, tenantId: string, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantId]);
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {
      // Rollback failing (e.g. connection already broken) shouldn't mask
      // the original error that triggered it.
    });
    throw err;
  } finally {
    client.release();
  }
}

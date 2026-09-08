import { Pool } from "pg";
import { AuthUserStore, AuthUserRecord } from "./auth.service";
import { runWithTenantContext } from "../../common/postgres";

interface AppUserRow {
  id: string;
  tenant_id: string;
  email: string;
  role: AuthUserRecord["role"];
  password_hash: string;
  mfa_secret: string | null;
  mfa_enabled: boolean;
}

function rowToRecord(row: AppUserRow): AuthUserRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    email: row.email,
    role: row.role,
    passwordHash: row.password_hash,
    mfaSecret: row.mfa_secret ?? undefined,
    mfaEnabled: row.mfa_enabled,
  };
}

/**
 * Real Postgres-backed AuthUserStore, against the app_user table from
 * 0001_tenant_and_rls.sql (+ 0003's mfa_secret column, +0005's
 * password_hash column — both real gaps found only by actually building
 * this class, not present in the original migration). Same tenant-context-
 * per-transaction pattern as PgConsentStore/PgRatingStore — see
 * src/common/postgres.ts.
 *
 * ACTUALLY RUN against a real local PostgreSQL 17 instance — see
 * pg-auth-user.store.test.ts (gated behind TEST_DATABASE_URL).
 */
export class PgAuthUserStore implements AuthUserStore {
  constructor(private readonly pool: Pool) {}

  async findByEmail(tenantId: string, email: string): Promise<AuthUserRecord | null> {
    const result = await runWithTenantContext(this.pool, tenantId, (client) =>
      client.query<AppUserRow>(`select * from app_user where tenant_id = $1 and email = $2`, [tenantId, email])
    );
    return result.rows[0] ? rowToRecord(result.rows[0]) : null;
  }

  async findById(tenantId: string, id: string): Promise<AuthUserRecord | null> {
    const result = await runWithTenantContext(this.pool, tenantId, (client) =>
      client.query<AppUserRow>(`select * from app_user where tenant_id = $1 and id = $2`, [tenantId, id])
    );
    return result.rows[0] ? rowToRecord(result.rows[0]) : null;
  }

  async save(user: AuthUserRecord): Promise<void> {
    await runWithTenantContext(this.pool, user.tenantId, (client) =>
      client.query(
        `insert into app_user (id, tenant_id, email, role, password_hash, mfa_secret, mfa_enabled)
         values ($1, $2, $3, $4, $5, $6, $7)
         on conflict (id) do update set
           email         = excluded.email,
           role          = excluded.role,
           password_hash = excluded.password_hash,
           mfa_secret    = excluded.mfa_secret,
           mfa_enabled   = excluded.mfa_enabled`,
        [user.id, user.tenantId, user.email, user.role, user.passwordHash, user.mfaSecret ?? null, user.mfaEnabled]
      )
    );
  }
}

import { Pool } from "pg";
import { AdminUserRecord, AdminUserStore } from "./admin-auth.service";

interface AdminUserRow {
  id: string;
  email: string;
  password_hash: string;
  mfa_secret: string | null;
  mfa_enabled: boolean;
  is_active: boolean;
  created_at: Date;
}

function rowToRecord(row: AdminUserRow): AdminUserRecord {
  return {
    id: row.id,
    email: row.email,
    passwordHash: row.password_hash,
    mfaSecret: row.mfa_secret ?? undefined,
    mfaEnabled: row.mfa_enabled,
    isActive: row.is_active,
    createdAt: row.created_at,
  };
}

/** Real Postgres-backed AdminUserStore, against `admin_user`
 * (db/migrations/0049). No RLS, no runWithTenantContext — this table has
 * no tenant_id at all, same root-registry reasoning as PilotSummaryService's
 * own plain queries against `tenant`. */
export class PgAdminUserStore implements AdminUserStore {
  constructor(private readonly pool: Pool) {}

  async findByEmail(email: string): Promise<AdminUserRecord | null> {
    const result = await this.pool.query<AdminUserRow>(`select * from admin_user where email = $1`, [email]);
    return result.rows[0] ? rowToRecord(result.rows[0]) : null;
  }

  async findById(id: string): Promise<AdminUserRecord | null> {
    const result = await this.pool.query<AdminUserRow>(`select * from admin_user where id = $1`, [id]);
    return result.rows[0] ? rowToRecord(result.rows[0]) : null;
  }

  async findAll(): Promise<AdminUserRecord[]> {
    const result = await this.pool.query<AdminUserRow>(`select * from admin_user order by created_at asc`);
    return result.rows.map(rowToRecord);
  }

  async save(user: AdminUserRecord): Promise<void> {
    await this.pool.query(
      `insert into admin_user (id, email, password_hash, mfa_secret, mfa_enabled, is_active)
       values ($1, $2, $3, $4, $5, $6)
       on conflict (id) do update set
         email         = excluded.email,
         password_hash = excluded.password_hash,
         mfa_secret    = excluded.mfa_secret,
         mfa_enabled   = excluded.mfa_enabled,
         is_active     = excluded.is_active`,
      [user.id, user.email, user.passwordHash, user.mfaSecret ?? null, user.mfaEnabled, user.isActive]
    );
  }
}

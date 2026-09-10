import { Pool } from "pg";
import { TenantRecord, TenantStore } from "./tenant.service";

interface TenantRow {
  id: string;
  name: string;
  notification_phone_e164: string | null;
}

/** Real Postgres-backed TenantStore, against `tenant` (0001_tenant_and_rls.sql,
 * 0014_tenant_notification_phone.sql). `tenant` itself carries no RLS — it's
 * the root registry every tenant_id column references (see postgres.ts's own
 * comment) — so plain queries are correct here, same as AuthModule's own
 * demo-tenant seed. */
export class PgTenantStore implements TenantStore {
  constructor(private readonly pool: Pool) {}

  async create(tenant: TenantRecord): Promise<void> {
    await this.pool.query(`insert into tenant (id, name) values ($1, $2)`, [tenant.id, tenant.name]);
  }

  async findById(id: string): Promise<TenantRecord | null> {
    const result = await this.pool.query<TenantRow>(`select id, name, notification_phone_e164 from tenant where id = $1`, [id]);
    const row = result.rows[0];
    if (!row) return null;
    return { id: row.id, name: row.name, notificationPhoneE164: row.notification_phone_e164 ?? undefined };
  }

  async updateNotificationPhone(id: string, phoneE164: string): Promise<void> {
    await this.pool.query(`update tenant set notification_phone_e164 = $1, updated_at = now() where id = $2`, [phoneE164, id]);
  }
}

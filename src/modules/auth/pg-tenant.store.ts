import { Pool } from "pg";
import { BusinessProfileInput, TenantRecord, TenantStore } from "./tenant.service";

interface TenantRow {
  id: string;
  name: string;
  notification_phone_e164: string | null;
  payfast_merchant_id: string | null;
  description: string | null;
  industry: string | null;
  location: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  business_goal: string | null;
}

/** BusinessProfileInput's own six keys, mapped to their real column names
 * (migration 0024) — one source of truth for updateBusinessProfile()'s
 * dynamic SET clause below, instead of hand-writing the mapping twice. */
const BUSINESS_PROFILE_COLUMNS: Record<keyof BusinessProfileInput, string> = {
  description: "description",
  industry: "industry",
  location: "location",
  contactEmail: "contact_email",
  contactPhone: "contact_phone",
  businessGoal: "business_goal",
};

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
    const result = await this.pool.query<TenantRow>(
      `select id, name, notification_phone_e164, payfast_merchant_id,
              description, industry, location, contact_email, contact_phone, business_goal
       from tenant where id = $1`,
      [id]
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      id: row.id,
      name: row.name,
      notificationPhoneE164: row.notification_phone_e164 ?? undefined,
      payfastMerchantId: row.payfast_merchant_id ?? undefined,
      description: row.description ?? undefined,
      industry: row.industry ?? undefined,
      location: row.location ?? undefined,
      contactEmail: row.contact_email ?? undefined,
      contactPhone: row.contact_phone ?? undefined,
      businessGoal: row.business_goal ?? undefined,
    };
  }

  async updateNotificationPhone(id: string, phoneE164: string): Promise<void> {
    await this.pool.query(`update tenant set notification_phone_e164 = $1, updated_at = now() where id = $2`, [phoneE164, id]);
  }

  async updatePayfastMerchantId(id: string, payfastMerchantId: string): Promise<void> {
    await this.pool.query(`update tenant set payfast_merchant_id = $1, updated_at = now() where id = $2`, [payfastMerchantId, id]);
  }

  /** Only the keys actually present in `profile` (TenantService.
   * setBusinessProfile() already normalized every value to either a real
   * trimmed string or `undefined` for "clear this field") get a SET
   * clause — a key the caller never mentioned leaves that column
   * untouched, same "update only what changed" contract TenantStore's
   * other update methods already have, just generalized across six
   * optional columns instead of one required one. */
  async updateBusinessProfile(id: string, profile: BusinessProfileInput): Promise<void> {
    const keys = Object.keys(profile) as (keyof BusinessProfileInput)[];
    if (keys.length === 0) return;
    const setClauses = keys.map((key, i) => `${BUSINESS_PROFILE_COLUMNS[key]} = $${i + 2}`);
    const values = keys.map((key) => profile[key] ?? null);
    await this.pool.query(`update tenant set ${setClauses.join(", ")}, updated_at = now() where id = $1`, [id, ...values]);
  }
}

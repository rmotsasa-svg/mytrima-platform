import { Pool } from "pg";
import { TenantRecord, TenantStore } from "./tenant.service";

/** Real Postgres-backed TenantStore, against `tenant` (0001_tenant_and_rls.sql).
 * `tenant` itself carries no RLS — it's the root registry every tenant_id
 * column references (see postgres.ts's own comment) — so a plain insert is
 * correct here, same as AuthModule's own demo-tenant seed. */
export class PgTenantStore implements TenantStore {
  constructor(private readonly pool: Pool) {}

  async create(tenant: TenantRecord): Promise<void> {
    await this.pool.query(`insert into tenant (id, name) values ($1, $2)`, [tenant.id, tenant.name]);
  }
}

import { Module } from "@nestjs/common";
import { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { AuthController } from "./auth.controller";
import { AuthService, AuthUserStore, RevokedRefreshTokenStore } from "./auth.service";
import { AccessTokenGuard } from "./access-token.guard";
import { InMemoryAuthUserStore } from "./in-memory-auth-user.store";
import { PgAuthUserStore } from "./pg-auth-user.store";
import { InMemoryRevokedRefreshTokenStore } from "./in-memory-revoked-token.store";
import { PgRevokedRefreshTokenStore } from "./pg-revoked-token.store";
import { RevokedTokenCleanupService } from "./revoked-token-cleanup.service";
import { AUTH_USER_STORE, JWT_SECRET, REVOKED_REFRESH_TOKEN_STORE, MFA_ENCRYPTION_KEY } from "./auth.tokens";
import { hashPassword } from "./password";
import { generateMfaEncryptionKey } from "./mfa-secret-crypto";
import { PG_POOL } from "../../common/database.module";
import { DEMO_TENANT_ID } from "../../common/demo-tenant";

/**
 * DEMO ONLY: seeds one staff account so the dashboard's login form (GET /)
 * has something real to authenticate against, alongside the real
 * POST /auth/register endpoint now available for everything else. Delete
 * this seed once the dashboard has its own signup form; a hardcoded demo
 * password must never ship past this scaffold stage.
 */
const DEMO_USER_EMAIL = "demo@mytrima.com";
const DEMO_USER_PASSWORD = "demo1234";

/**
 * KNOWN GAP: both secrets fall back to a hardcoded/freshly-generated dev-only
 * value when their env vars are unset. Per Master Plan Section 10, secrets
 * belong in a dedicated secrets manager, never source control:
 *   - JWT_SECRET: falls back to a fixed string — must become a required (no
 *     fallback) environment variable before this is deployed anywhere real.
 *   - MFA_ENCRYPTION_KEY: falls back to a freshly-generated random key on
 *     every process start. This was a lower-stakes flag when only the
 *     in-memory store existed (everything was lost on restart anyway) — now
 *     that PgAuthUserStore makes real persistence possible, this is a real,
 *     live footgun: an owner's MFA secret persists in Postgres across a
 *     restart, but the key to decrypt it does not, silently locking every
 *     owner-role account out of their own account. Must become a required,
 *     persisted, real key before DATABASE_URL is ever set outside a
 *     throwaway dev database.
 */
const DEV_ONLY_JWT_SECRET_FALLBACK = "dev-only-insecure-secret-do-not-use-in-production";

@Module({
  controllers: [AuthController],
  providers: [
    AuthService,
    AccessTokenGuard,
    RevokedTokenCleanupService,
    {
      provide: AUTH_USER_STORE,
      inject: [PG_POOL],
      useFactory: async (pool: Pool | null): Promise<AuthUserStore> => {
        if (pool) {
          // Real foreign-key constraint: app_user.tenant_id references a
          // real tenant row, so — unlike the in-memory path, where any
          // string works as a Map key — the demo tenant has to genuinely
          // exist before the demo user can be inserted.
          await pool.query(`insert into tenant (id, name) values ($1, 'Demo Tenant') on conflict (id) do nothing`, [DEMO_TENANT_ID]);
          const store = new PgAuthUserStore(pool);
          const existing = await store.findByEmail(DEMO_TENANT_ID, DEMO_USER_EMAIL);
          if (!existing) {
            await store.save({
              id: randomUUID(),
              tenantId: DEMO_TENANT_ID,
              email: DEMO_USER_EMAIL,
              role: "staff",
              passwordHash: await hashPassword(DEMO_USER_PASSWORD),
              mfaEnabled: false,
            });
          }
          return store;
        }

        const store = new InMemoryAuthUserStore();
        store.seed({
          id: "demo-user-1",
          tenantId: DEMO_TENANT_ID,
          email: DEMO_USER_EMAIL,
          role: "staff", // no MFA gate, so the demo login form doesn't also need a TOTP app
          passwordHash: await hashPassword(DEMO_USER_PASSWORD),
          mfaEnabled: false,
        });
        return store;
      },
    },
    { provide: JWT_SECRET, useValue: process.env.JWT_SECRET ?? DEV_ONLY_JWT_SECRET_FALLBACK },
    {
      provide: REVOKED_REFRESH_TOKEN_STORE,
      inject: [PG_POOL],
      useFactory: (pool: Pool | null): RevokedRefreshTokenStore =>
        pool ? new PgRevokedRefreshTokenStore(pool) : new InMemoryRevokedRefreshTokenStore(),
    },
    { provide: MFA_ENCRYPTION_KEY, useValue: process.env.MFA_ENCRYPTION_KEY ?? generateMfaEncryptionKey() },
  ],
  // Exported so a future seed/registration mechanism can reach the same
  // store instance this module's AuthController resolves against.
  exports: [AUTH_USER_STORE],
})
export class AuthModule {}

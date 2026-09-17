import { Module } from "@nestjs/common";
import { Pool } from "pg";
import { AdminAuthController } from "./admin-auth.controller";
import { AdminAuthService, AdminUserStore, AdminRevokedRefreshTokenStore } from "./admin-auth.service";
import { AdminAccessTokenGuard } from "./admin-access-token.guard";
import { AdminMfaEnrollmentOrAccessTokenGuard } from "./admin-mfa-enrollment-or-access-token.guard";
import { InMemoryAdminUserStore } from "./in-memory-admin-user.store";
import { PgAdminUserStore } from "./pg-admin-user.store";
import { InMemoryAdminRevokedRefreshTokenStore } from "./in-memory-admin-revoked-token.store";
import { PgAdminRevokedRefreshTokenStore } from "./pg-admin-revoked-token.store";
import { ADMIN_USER_STORE, ADMIN_REVOKED_REFRESH_TOKEN_STORE } from "./admin-auth.tokens";
import { JWT_SECRET, MFA_ENCRYPTION_KEY } from "../auth/auth.tokens";
import { generateMfaEncryptionKey } from "../auth/mfa-secret-crypto";
import { PG_POOL } from "../../common/database.module";

/** KNOWN GAP, same as auth.module.ts's own identical comment: JWT_SECRET
 * falls back to a fixed dev-only string, and MFA_ENCRYPTION_KEY falls back
 * to a freshly-generated key on every process start — both must become
 * required env vars before this is deployed anywhere real. Deliberately
 * the SAME fallback string as AuthModule's own DEV_ONLY_JWT_SECRET_FALLBACK
 * (not a second, different one) — both modules resolve process.env.JWT_SECRET
 * when it's set, and using a different dev-only fallback would make admin
 * and tenant tokens diverge in dev for no real reason. */
const DEV_ONLY_JWT_SECRET_FALLBACK = "dev-only-insecure-secret-do-not-use-in-production";

/** Exported so AdminModule (admin/admin.module.ts) can inject
 * AdminAuthService/AdminAccessTokenGuard directly — its own controller
 * moves from the shared ADMIN_API_KEY secret to real per-admin auth in
 * the same change that adds this module. JWT_SECRET/MFA_ENCRYPTION_KEY
 * re-declared locally rather than importing the whole AuthModule — see
 * admin-auth.tokens.ts's own comment. */
@Module({
  controllers: [AdminAuthController],
  providers: [
    AdminAuthService,
    AdminAccessTokenGuard,
    AdminMfaEnrollmentOrAccessTokenGuard,
    { provide: JWT_SECRET, useValue: process.env.JWT_SECRET ?? DEV_ONLY_JWT_SECRET_FALLBACK },
    { provide: MFA_ENCRYPTION_KEY, useValue: process.env.MFA_ENCRYPTION_KEY ?? generateMfaEncryptionKey() },
    {
      provide: ADMIN_USER_STORE,
      inject: [PG_POOL],
      useFactory: (pool: Pool | null): AdminUserStore => (pool ? new PgAdminUserStore(pool) : new InMemoryAdminUserStore()),
    },
    {
      provide: ADMIN_REVOKED_REFRESH_TOKEN_STORE,
      inject: [PG_POOL],
      useFactory: (pool: Pool | null): AdminRevokedRefreshTokenStore =>
        pool ? new PgAdminRevokedRefreshTokenStore(pool) : new InMemoryAdminRevokedRefreshTokenStore(),
    },
  ],
  exports: [AdminAuthService, AdminAccessTokenGuard],
})
export class AdminAuthModule {}

import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import type { Request } from "express";

/**
 * Real gap found by deep review: nothing lets the platform OPERATOR (not
 * any tenant — this is deliberately cross-tenant, see pilot-summary.service.ts)
 * see which of the 5-10 pilot tenants are active, stalled, or need a nudge.
 * For a grant-funded pilot, that's a real risk: no way to answer "what
 * impact did this have" without it.
 *
 * NARROWED ROLE (Phase 1 of the admin-platform plan): this used to gate
 * every `/admin/*` route via a single shared secret. Real, per-admin
 * authentication now exists (admin-auth/) — every route that used to sit
 * behind this guard now sits behind AdminAccessTokenGuard instead. This
 * guard's only remaining job is `POST /admin-auth/register`, bootstrapping
 * the very first admin account when none exist yet (the same "shared
 * secret gets you in the door once, then real per-identity auth takes
 * over" pattern TENANT_SIGNUP_CODE already used for tenant #1, before
 * self-serve signup opened up). Kept, not deleted, because that bootstrap
 * problem is real: nothing can call an admin-authenticated endpoint to
 * create the first admin, the same reasoning `POST /auth/tenants`
 * documents for a brand-new tenant's first owner.
 */
export class AdminApiKeyNotConfiguredError extends Error {
  constructor() {
    super("Admin API is not enabled on this deployment — set ADMIN_API_KEY to enable it");
    this.name = "AdminApiKeyNotConfiguredError";
  }
}

export class InvalidAdminApiKeyError extends Error {
  constructor() {
    super("Invalid admin API key");
    this.name = "InvalidAdminApiKeyError";
  }
}

const ADMIN_API_KEY_HEADER = "x-admin-api-key";

@Injectable()
export class AdminApiKeyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const configuredKey = process.env.ADMIN_API_KEY;
    if (!configuredKey) throw new AdminApiKeyNotConfiguredError();

    const request = context.switchToHttp().getRequest<Request>();
    const providedKey = request.headers[ADMIN_API_KEY_HEADER];
    if (providedKey !== configuredKey) throw new InvalidAdminApiKeyError();
    return true;
  }
}

import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import type { Request } from "express";

/**
 * Real gap found by deep review: nothing lets the platform OPERATOR (not
 * any tenant — this is deliberately cross-tenant, see pilot-summary.service.ts)
 * see which of the 5-10 pilot tenants are active, stalled, or need a nudge.
 * For a grant-funded pilot, that's a real risk: no way to answer "what
 * impact did this have" without it.
 *
 * Deliberately NOT wired into the existing tenant-scoped RBAC system
 * (rbac.ts's Role/Permission model) — that system's entire design is
 * "no cross-tenant role exists by design" (rbac.ts's own top comment), and
 * bending it to add a cross-tenant admin role would be a bigger, riskier
 * change than this pilot needs. Instead: a single shared secret
 * (ADMIN_API_KEY), checked via a request header — same "gated via a shared
 * secret, fails closed if unset" pattern already established for
 * TENANT_SIGNUP_CODE (tenant.service.ts's own verifySignupCode()), applied
 * to the one operator instead of a cohort of tenants. Revisit with a real
 * admin-role system if this platform ever needs more than one operator.
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

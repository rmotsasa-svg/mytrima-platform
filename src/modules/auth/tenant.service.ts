import { Inject, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { AuthService, PublicAuthUserRecord } from "./auth.service";
import { TENANT_STORE } from "./tenant.tokens";

/**
 * Master Plan Addendum v1.3, Section H: closes a gap the platform has had
 * since its first Auth module. Every registration endpoint correctly
 * requires an already-authenticated owner (AccessTokenGuard + rbac.ts's
 * authorize() against 'user:manage') to invite anyone else — which means
 * nothing can call it for a brand-new tenant's very first account, since
 * there is no existing owner to authenticate as yet. This is a separate
 * service, not a new method/dependency on AuthService itself, specifically
 * to avoid changing AuthService's constructor — it is instantiated directly
 * (not through Nest's DI container) in a large number of existing tests
 * across the auth module, and a new required dependency there would break
 * every one of them for a concern (tenant provisioning) that is genuinely
 * separate from authenticating an existing account.
 *
 * Default applied (per the addendum's sign-off): gated via a shared signup
 * code (TENANT_SIGNUP_CODE env var), matching the pilot's controlled 5-10
 * tenant cohort (Master Plan Section 3) at the lowest implementation cost.
 * Fails CLOSED, not open: if the env var is unset, signup is disabled
 * entirely rather than accidentally left public.
 */

export interface TenantRecord {
  id: string;
  name: string;
}

export interface TenantStore {
  create(tenant: TenantRecord): Promise<void>;
}

export class InvalidTenantNameError extends Error {
  constructor() {
    super("tenantName is required");
    this.name = "InvalidTenantNameError";
  }
}

export class TenantSignupNotEnabledError extends Error {
  constructor() {
    super("Tenant self-service signup is not enabled on this deployment");
    this.name = "TenantSignupNotEnabledError";
  }
}

export class InvalidSignupCodeError extends Error {
  constructor() {
    super("Invalid signup code");
    this.name = "InvalidSignupCodeError";
  }
}

export interface RegisterTenantResult {
  tenantId: string;
  owner: PublicAuthUserRecord;
}

@Injectable()
export class TenantService {
  constructor(
    @Inject(TENANT_STORE) private readonly store: TenantStore,
    private readonly authService: AuthService
  ) {}

  /**
   * Checked by the caller (AuthController), not here, against the raw
   * env var — kept a plain function rather than a method so it has no
   * dependency on this class being constructed, matching how simple a
   * "compare two strings" check should be.
   */
  static verifySignupCode(providedCode: string | undefined): void {
    const configuredCode = process.env.TENANT_SIGNUP_CODE;
    if (!configuredCode) throw new TenantSignupNotEnabledError();
    if (providedCode !== configuredCode) throw new InvalidSignupCodeError();
  }

  async registerTenant(tenantName: string, ownerEmail: string, ownerPassword: string): Promise<RegisterTenantResult> {
    if (!tenantName.trim()) throw new InvalidTenantNameError();
    const tenantId = randomUUID();
    await this.store.create({ id: tenantId, name: tenantName.trim() });
    // register()'s own WeakPasswordError/EmailAlreadyRegisteredError checks
    // apply unchanged — a new tenant's owner is still a real account subject
    // to the same password/uniqueness rules as any invited staff member.
    const owner = await this.authService.register(tenantId, ownerEmail, ownerPassword, "owner", randomUUID());
    return { tenantId, owner };
  }
}

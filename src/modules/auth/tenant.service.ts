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
  /** Where a real WhatsApp notification actually gets sent — see
   * notification-worker.service.ts. Nullable: most tenants won't have set
   * one yet, and a notification job should fail loudly with a clear reason
   * (NotificationPhoneNotConfiguredError) rather than silently no-op or
   * guess a recipient. One number per tenant, not per staff member —
   * right-sized for the pilot cohort (Master Plan Section 3), same
   * reasoning as the shared signup code above; revisit if per-staff routing
   * is ever actually requested. */
  notificationPhoneE164?: string;
  /** The Tenant's own PayFast merchant ID — where their share of a payment
   * actually lands, per the real-time Split Payments flow (see
   * payfast.service.ts's own top comment on the merchant-of-record
   * decision). Nullable: a Tenant who hasn't provided theirs yet can't
   * check out through PayFastController, a real, expected state to fail
   * loudly on. This is the Tenant's own PayFast account id, never
   * Mytrima's own merchant credentials. */
  payfastMerchantId?: string;
  /** REAL GAP closed 2026-09-11, migration 0024: none of these six existed
   * anywhere in this schema until the tenant directly asked where their
   * business setup page was. All nullable, same reasoning as
   * notificationPhoneE164/payfastMerchantId above — unset is a real,
   * expected state right after signup, not an error. */
  description?: string;
  industry?: string;
  location?: string;
  /** The business's own public-facing contact details — deliberately a
   * separate concept from notificationPhoneE164 (where WhatsApp automation
   * sends internal alerts, see that field's own comment), even though one
   * of them also happens to be a phone number. */
  contactEmail?: string;
  contactPhone?: string;
  businessGoal?: string;
}

/** What POST /auth/tenants/business-profile actually accepts — every field
 * optional so a tenant can fill this in incrementally (set an industry
 * today, come back and add a business goal next week) rather than being
 * forced through all six at once. */
export interface BusinessProfileInput {
  description?: string;
  industry?: string;
  location?: string;
  contactEmail?: string;
  contactPhone?: string;
  businessGoal?: string;
}

export interface TenantStore {
  create(tenant: TenantRecord): Promise<void>;
  findById(id: string): Promise<TenantRecord | null>;
  updateNotificationPhone(id: string, phoneE164: string): Promise<void>;
  updatePayfastMerchantId(id: string, payfastMerchantId: string): Promise<void>;
  updateBusinessProfile(id: string, profile: BusinessProfileInput): Promise<void>;
}

export class InvalidTenantNameError extends Error {
  constructor() {
    super("tenantName is required");
    this.name = "InvalidTenantNameError";
  }
}

export class InvalidNotificationPhoneError extends Error {
  constructor() {
    super("notificationPhoneE164 is required and must be in E.164 format (e.g. +26612345678)");
    this.name = "InvalidNotificationPhoneError";
  }
}

export class InvalidPayfastMerchantIdError extends Error {
  constructor() {
    super("payfastMerchantId is required and must be numeric, matching PayFast's own merchant_id format");
    this.name = "InvalidPayfastMerchantIdError";
  }
}

export class InvalidContactEmailError extends Error {
  constructor() {
    super("contactEmail must be a valid email address");
    this.name = "InvalidContactEmailError";
  }
}

export class InvalidContactPhoneError extends Error {
  constructor() {
    super("contactPhone must be in E.164 format (e.g. +26612345678)");
    this.name = "InvalidContactPhoneError";
  }
}

// PayFast's own docs: "merchant_id: integer, 8 char" — loose on exact
// length (their sandbox test id, 10000100, is 8 digits, but this doesn't
// hardcode that as a hard rule for real accounts of unknown exact length).
const PAYFAST_MERCHANT_ID_PATTERN = /^\d+$/;

// Deliberately loose (not a full E.164 validator library) — same
// right-sized-for-pilot judgment as everywhere else in this file. Rejects
// the obviously wrong shapes (empty, no leading +, non-digits) without
// pretending to validate every real-world numbering-plan rule.
const E164_PATTERN = /^\+[1-9]\d{6,14}$/;

// Same deliberately-loose judgment as E164_PATTERN above — rejects the
// obviously wrong shapes without pretending to implement RFC 5322.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

  /** Sets/replaces the one phone number real WhatsApp notifications for this
   * tenant are sent to — see TenantRecord's own comment on why it's a
   * single tenant-level number, not per-staff. */
  async setNotificationPhone(tenantId: string, phoneE164: string): Promise<void> {
    if (!E164_PATTERN.test(phoneE164)) throw new InvalidNotificationPhoneError();
    await this.store.updateNotificationPhone(tenantId, phoneE164);
  }

  /** Sets/replaces the Tenant's own PayFast merchant id — see
   * TenantRecord's own comment on why this is required before
   * PayFastController can check this Tenant out at all. */
  async setPayfastMerchantId(tenantId: string, payfastMerchantId: string): Promise<void> {
    if (!PAYFAST_MERCHANT_ID_PATTERN.test(payfastMerchantId)) throw new InvalidPayfastMerchantIdError();
    await this.store.updatePayfastMerchantId(tenantId, payfastMerchantId);
  }

  async getById(tenantId: string): Promise<TenantRecord | null> {
    return this.store.findById(tenantId);
  }

  /**
   * Sets/replaces any subset of the six business-profile fields — see
   * BusinessProfileInput's own comment on why every field is optional (a
   * tenant fills this in incrementally, not all at once). A field present
   * in `profile` but blank after trimming is treated as "clear it", not an
   * error — unlike tenantName at registration, there's no reason a
   * business can't decide it no longer wants a stated goal on file.
   * contactEmail gets a real (if deliberately loose, same "right-sized for
   * pilot" judgment as E164_PATTERN above) shape check since a malformed
   * one is silently useless the moment someone tries to use it; the four
   * free-text fields (description/industry/location/businessGoal) get none
   * — there's no wrong shape for a sentence describing what a business
   * does.
   */
  async setBusinessProfile(tenantId: string, profile: BusinessProfileInput): Promise<void> {
    const normalized: BusinessProfileInput = {};
    for (const key of ["description", "industry", "location", "contactEmail", "contactPhone", "businessGoal"] as const) {
      const value = profile[key];
      if (value === undefined) continue;
      const trimmed = value.trim();
      normalized[key] = trimmed.length > 0 ? trimmed : undefined;
    }
    if (normalized.contactEmail && !EMAIL_PATTERN.test(normalized.contactEmail)) {
      throw new InvalidContactEmailError();
    }
    if (normalized.contactPhone && !E164_PATTERN.test(normalized.contactPhone)) {
      throw new InvalidContactPhoneError();
    }
    await this.store.updateBusinessProfile(tenantId, normalized);
  }
}

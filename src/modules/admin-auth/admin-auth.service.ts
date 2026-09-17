import { Inject, Injectable } from "@nestjs/common";
import crypto from "node:crypto";
import { hashPassword, verifyPassword } from "../auth/password";
import { signJwt, verifyJwt, InvalidTokenError, JwtPayloadBase } from "../auth/jwt";
import { generateBase32Secret, verifyTotp } from "../auth/totp";
import { encryptMfaSecret, decryptMfaSecret } from "../auth/mfa-secret-crypto";
import { JWT_SECRET, MFA_ENCRYPTION_KEY } from "../auth/auth.tokens";
import { ADMIN_USER_STORE, ADMIN_REVOKED_REFRESH_TOKEN_STORE } from "./admin-auth.tokens";

/**
 * Real multi-admin authentication for the platform operator — see
 * C:\Users\USER\.claude\plans\twinkly-sprouting-orbit.md, Phase 1. A
 * deliberate structural mirror of auth.service.ts, reusing the exact same
 * hand-rolled, dependency-free crypto primitives (password.ts/jwt.ts/
 * totp.ts/mfa-secret-crypto.ts) this codebase already trusts, but
 * genuinely simpler: no tenantId (an admin isn't scoped to any tenant),
 * no Role/RBAC branching (one implicit admin role for v1 — see the
 * plan's own "don't invent a permission split nothing has asked for"
 * note), and MFA is unconditionally mandatory rather than owner-only.
 * Every JWT this issues carries its own `admin_*` type discriminator
 * (never plain "access"/"refresh") so a tenant token can never be
 * replayed against an admin route or vice versa — verifyJwt() itself is
 * payload-shape-agnostic, the type check is this file's own job, same as
 * auth.service.ts's own access/refresh/mfa_enrollment/email_verification
 * token types.
 */

export interface AdminUserRecord {
  id: string;
  email: string;
  passwordHash: string;
  /** AES-256-GCM ciphertext, never plaintext — see mfa-secret-crypto.ts.
   * Encrypt with encryptMfaSecret() before ever passing a record to
   * store.save(); decrypt only at the point of verifying a TOTP code. */
  mfaSecret?: string;
  mfaEnabled: boolean;
  isActive: boolean;
  createdAt: Date;
}

export interface AdminUserStore {
  findByEmail(email: string): Promise<AdminUserRecord | null>;
  findById(id: string): Promise<AdminUserRecord | null>;
  findAll(): Promise<AdminUserRecord[]>;
  save(user: AdminUserRecord): Promise<void>;
}

/** No tenantId — an admin refresh token has no tenant to scope to, unlike
 * RevokedRefreshTokenStore (auth.service.ts), whose own comment explains
 * exactly why that one needs it (real RLS-scoped table). admin_user has
 * no RLS at all (see migration 0049's own comment). */
export interface AdminRevokedRefreshTokenStore {
  isRevoked(jti: string): Promise<boolean>;
  revoke(adminUserId: string, jti: string, expiresAt: Date): Promise<void>;
}

export class AdminInvalidCredentialsError extends Error {
  constructor() {
    // Deliberately identical message for "no such admin" and "wrong
    // password" — same account-enumeration reasoning as the tenant
    // InvalidCredentialsError's own comment.
    super("Invalid email or password");
    this.name = "AdminInvalidCredentialsError";
  }
}

export class AdminMfaEnrollmentRequiredError extends Error {
  /** `enrollmentToken` only set on the login()-thrown instance — same
   * reasoning as MfaEnrollmentRequiredError's own comment. */
  constructor(
    public readonly adminUserId: string,
    public readonly enrollmentToken?: string
  ) {
    super("Admin accounts must enroll MFA before signing in");
    this.name = "AdminMfaEnrollmentRequiredError";
  }
}

export class AdminMfaRequiredError extends Error {
  constructor(public readonly adminUserId: string) {
    super("MFA code required to complete sign-in");
    this.name = "AdminMfaRequiredError";
  }
}

export class AdminMfaInvalidCodeError extends Error {
  constructor() {
    super("Invalid MFA code");
    this.name = "AdminMfaInvalidCodeError";
  }
}

export class AdminEmailAlreadyRegisteredError extends Error {
  constructor(email: string) {
    super(`An admin account with email "${email}" already exists`);
    this.name = "AdminEmailAlreadyRegisteredError";
  }
}

export class AdminWeakPasswordError extends Error {
  constructor(minLength: number) {
    super(`Password must be at least ${minLength} characters`);
    this.name = "AdminWeakPasswordError";
  }
}

export class AdminUserNotFoundError extends Error {
  constructor(adminUserId: string) {
    super(`No admin user found with id "${adminUserId}"`);
    this.name = "AdminUserNotFoundError";
  }
}

export class AdminAccountDeactivatedError extends Error {
  constructor() {
    super("This admin account has been deactivated");
    this.name = "AdminAccountDeactivatedError";
  }
}

/** The platform must always keep at least one active admin able to manage
 * the others — same invariant, same reasoning as CannotRemoveLastOwnerError
 * (auth.service.ts), mirrored for the admin-account namespace. */
export class CannotRemoveLastAdminError extends Error {
  constructor() {
    super("The platform must keep at least one active admin — reactivate another admin first");
    this.name = "CannotRemoveLastAdminError";
  }
}

/** Thrown by register() when a bootstrap attempt is made but at least one
 * real admin already exists — the shared ADMIN_API_KEY's only remaining
 * job (see admin-api-key.guard.ts's own updated comment) is creating the
 * very first admin; every admin after that is created by an already-
 * authenticated admin through POST /admin-auth/admins instead. */
export class AdminBootstrapAlreadyCompleteError extends Error {
  constructor() {
    super("An admin account already exists — sign in and use POST /admin-auth/admins to create another one");
    this.name = "AdminBootstrapAlreadyCompleteError";
  }
}

export interface AdminTokenPair {
  accessToken: string;
  refreshToken: string;
}

interface AdminAccessTokenPayload extends JwtPayloadBase {
  sub: string;
  type: "admin_access";
}

interface AdminRefreshTokenPayload extends JwtPayloadBase {
  sub: string;
  type: "admin_refresh";
  jti: string;
}

/** Same shape/reasoning as auth.service.ts's own MfaEnrollmentTokenPayload
 * — a short-lived, single-purpose token so a freshly-registered admin
 * (who has no real access token until MFA is enrolled) can still reach
 * the two enrollment endpoints. See AdminMfaEnrollmentOrAccessTokenGuard. */
interface AdminMfaEnrollmentTokenPayload extends JwtPayloadBase {
  sub: string;
  type: "admin_mfa_enrollment";
}

const MFA_ENROLLMENT_TOKEN_TTL_SECONDS = 600;

export interface VerifiedAdminAccessToken {
  adminUserId: string;
}

/** The safe-to-return subset of AdminUserRecord — no passwordHash, no
 * mfaSecret. Same "filter at the service layer so no future caller can
 * forget" reasoning as PublicAuthUserRecord's own comment. */
export interface PublicAdminUserRecord {
  id: string;
  email: string;
  mfaEnabled: boolean;
  isActive: boolean;
  createdAt: Date;
}

export interface AdminMfaEnrollmentStart {
  secret: string;
  otpauthUrl: string;
}

const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;
const MIN_PASSWORD_LENGTH = 8;

@Injectable()
export class AdminAuthService {
  constructor(
    @Inject(ADMIN_USER_STORE) private readonly store: AdminUserStore,
    @Inject(JWT_SECRET) private readonly jwtSecret: string,
    @Inject(ADMIN_REVOKED_REFRESH_TOKEN_STORE) private readonly revokedTokens: AdminRevokedRefreshTokenStore,
    @Inject(MFA_ENCRYPTION_KEY) private readonly mfaEncryptionKey: string
  ) {}

  /** `bootstrap: true` (the caller behind AdminApiKeyGuard) refuses to run
   * once any real admin exists — see AdminBootstrapAlreadyCompleteError's
   * own comment. `bootstrap: false` (the caller behind
   * AdminAccessTokenGuard, an already-logged-in admin) has no such
   * restriction. Both funnel through this one method so "create an admin
   * account" is always exactly one real code path. */
  async register(email: string, password: string, id: string, bootstrap: boolean): Promise<PublicAdminUserRecord> {
    if (bootstrap && (await this.store.findAll()).length > 0) {
      throw new AdminBootstrapAlreadyCompleteError();
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      throw new AdminWeakPasswordError(MIN_PASSWORD_LENGTH);
    }
    const existing = await this.store.findByEmail(email);
    if (existing) {
      throw new AdminEmailAlreadyRegisteredError(email);
    }
    const user: AdminUserRecord = {
      id,
      email,
      passwordHash: await hashPassword(password),
      mfaEnabled: false,
      isActive: true,
      createdAt: new Date(),
    };
    await this.store.save(user);
    return this.toPublicRecord(user);
  }

  async listAdmins(): Promise<PublicAdminUserRecord[]> {
    const users = await this.store.findAll();
    return users.map((u) => this.toPublicRecord(u));
  }

  /** Self-service "who am I" — mirrors StaffApi.me()/GET /staff/me. */
  async getProfile(adminUserId: string): Promise<PublicAdminUserRecord> {
    const user = await this.store.findById(adminUserId);
    if (!user) throw new AdminUserNotFoundError(adminUserId);
    return this.toPublicRecord(user);
  }

  private toPublicRecord(user: AdminUserRecord): PublicAdminUserRecord {
    return { id: user.id, email: user.email, mfaEnabled: user.mfaEnabled, isActive: user.isActive, createdAt: user.createdAt };
  }

  /** MFA is unconditionally mandatory here — no role branch to check,
   * unlike AuthService.login()'s own `if (user.role === "owner")` gate.
   * An admin account can see/act on every tenant's data, so the blast
   * radius of one compromised password alone is strictly larger than any
   * single tenant owner's own account — see the plan's own "MFA is
   * mandatory for every admin account, no exception" decision. */
  async login(email: string, password: string, totpCode?: string): Promise<AdminTokenPair> {
    const user = await this.store.findByEmail(email);
    if (!user) throw new AdminInvalidCredentialsError();

    const passwordOk = await verifyPassword(password, user.passwordHash);
    if (!passwordOk) throw new AdminInvalidCredentialsError();

    if (!user.isActive) throw new AdminAccountDeactivatedError();

    if (!user.mfaEnabled || !user.mfaSecret) {
      const enrollmentToken = signJwt<Omit<AdminMfaEnrollmentTokenPayload, "iat" | "exp">>(
        { sub: user.id, type: "admin_mfa_enrollment" },
        this.jwtSecret,
        MFA_ENROLLMENT_TOKEN_TTL_SECONDS
      );
      throw new AdminMfaEnrollmentRequiredError(user.id, enrollmentToken);
    }
    if (!totpCode) {
      throw new AdminMfaRequiredError(user.id);
    }
    const decryptedSecret = decryptMfaSecret(user.mfaSecret, this.mfaEncryptionKey);
    if (!verifyTotp(decryptedSecret, totpCode)) {
      throw new AdminMfaInvalidCodeError();
    }

    return this.issueTokenPair(user);
  }

  async startMfaEnrollment(adminUserId: string): Promise<AdminMfaEnrollmentStart> {
    const user = await this.store.findById(adminUserId);
    if (!user) throw new AdminUserNotFoundError(adminUserId);

    const secret = generateBase32Secret();
    await this.store.save({ ...user, mfaSecret: encryptMfaSecret(secret, this.mfaEncryptionKey), mfaEnabled: false });

    const otpauthUrl = `otpauth://totp/Mytrima%20Admin:${encodeURIComponent(user.email)}?secret=${secret}&issuer=Mytrima%20Admin&algorithm=SHA1&digits=6&period=30`;
    return { secret, otpauthUrl };
  }

  async confirmMfaEnrollment(adminUserId: string, code: string): Promise<void> {
    const user = await this.store.findById(adminUserId);
    if (!user) throw new AdminUserNotFoundError(adminUserId);
    if (!user.mfaSecret) {
      throw new AdminMfaEnrollmentRequiredError(adminUserId);
    }
    const decryptedSecret = decryptMfaSecret(user.mfaSecret, this.mfaEncryptionKey);
    if (!verifyTotp(decryptedSecret, code)) {
      throw new AdminMfaInvalidCodeError();
    }
    await this.store.save({ ...user, mfaEnabled: true });
  }

  async refresh(refreshToken: string): Promise<AdminTokenPair> {
    const payload = verifyJwt<AdminRefreshTokenPayload>(refreshToken, this.jwtSecret);
    if (payload.type !== "admin_refresh") {
      throw new InvalidTokenError("Not an admin refresh token");
    }
    if (await this.revokedTokens.isRevoked(payload.jti)) {
      throw new InvalidTokenError("Refresh token has been revoked");
    }
    const user = await this.store.findById(payload.sub);
    if (!user) throw new AdminInvalidCredentialsError();
    if (!user.isActive) throw new AdminAccountDeactivatedError();

    await this.revokedTokens.revoke(payload.sub, payload.jti, new Date(payload.exp * 1000));
    return this.issueTokenPair(user);
  }

  async logout(refreshToken: string): Promise<void> {
    const payload = verifyJwt<AdminRefreshTokenPayload>(refreshToken, this.jwtSecret);
    if (payload.type !== "admin_refresh") {
      throw new InvalidTokenError("Not an admin refresh token");
    }
    await this.revokedTokens.revoke(payload.sub, payload.jti, new Date(payload.exp * 1000));
  }

  verifyAccessToken(accessToken: string): VerifiedAdminAccessToken {
    const payload = verifyJwt<AdminAccessTokenPayload>(accessToken, this.jwtSecret);
    if (payload.type !== "admin_access") {
      throw new InvalidTokenError("Not an admin access token");
    }
    return { adminUserId: payload.sub };
  }

  /** Used only by AdminMfaEnrollmentOrAccessTokenGuard, only on the two
   * MFA enrollment endpoints — same reasoning as
   * AuthService.verifyAccessOrMfaEnrollmentToken()'s own comment. */
  verifyAccessOrMfaEnrollmentToken(token: string): VerifiedAdminAccessToken {
    const payload = verifyJwt<(AdminAccessTokenPayload | AdminMfaEnrollmentTokenPayload) & { type: string }>(token, this.jwtSecret);
    if (payload.type !== "admin_access" && payload.type !== "admin_mfa_enrollment") {
      throw new InvalidTokenError("Token must be a real admin access token or a short-lived MFA-enrollment token");
    }
    return { adminUserId: payload.sub };
  }

  private async assertWouldNotRemoveLastActiveAdmin(excludingAdminUserId: string): Promise<void> {
    const all = await this.store.findAll();
    const remainingActive = all.filter((u) => u.id !== excludingAdminUserId && u.isActive);
    if (remainingActive.length === 0) throw new CannotRemoveLastAdminError();
  }

  async setActive(targetAdminUserId: string, isActive: boolean): Promise<PublicAdminUserRecord> {
    const user = await this.store.findById(targetAdminUserId);
    if (!user) throw new AdminUserNotFoundError(targetAdminUserId);

    if (!isActive) {
      await this.assertWouldNotRemoveLastActiveAdmin(targetAdminUserId);
    }

    const updated: AdminUserRecord = { ...user, isActive };
    await this.store.save(updated);
    return this.toPublicRecord(updated);
  }

  private issueTokenPair(user: AdminUserRecord): AdminTokenPair {
    const accessToken = signJwt<Omit<AdminAccessTokenPayload, "iat" | "exp">>({ sub: user.id, type: "admin_access" }, this.jwtSecret, ACCESS_TOKEN_TTL_SECONDS);
    const refreshToken = signJwt<Omit<AdminRefreshTokenPayload, "iat" | "exp">>(
      { sub: user.id, type: "admin_refresh", jti: crypto.randomUUID() },
      this.jwtSecret,
      REFRESH_TOKEN_TTL_SECONDS
    );
    return { accessToken, refreshToken };
  }
}

import { Inject, Injectable } from "@nestjs/common";
import { hashPassword, verifyPassword } from "./password";
import { signJwt, verifyJwt, InvalidTokenError, JwtPayloadBase } from "./jwt";
import { generateBase32Secret, verifyTotp } from "./totp";
import { encryptMfaSecret, decryptMfaSecret } from "./mfa-secret-crypto";
import { Role } from "./rbac";
import { AUTH_USER_STORE, JWT_SECRET, REVOKED_REFRESH_TOKEN_STORE, MFA_ENCRYPTION_KEY } from "./auth.tokens";
import crypto from "node:crypto";

/**
 * Master Plan Section 10 says "OAuth2/OIDC-based authentication" as the
 * target architecture, but never names a specific identity provider to
 * federate with — that is an unresolved decision, not a confirmed vendor
 * integration, so there is nothing here analogous to the
 * PendingVerificationError-stubbed integrations. What this module builds
 * instead is everything that decision does NOT block: password-based
 * credential auth, registration, JWT access/refresh token issuance with
 * rotation and revocation, TOTP MFA enrollment and enforcement for
 * Owner-level accounts — all real, tested, and usable today. "Sign in with
 * Google/Microsoft/etc." federation is NOT implemented; adding it later
 * means adding a new login path that, on success, calls the same
 * issueTokenPair() this module already has — it should not require
 * touching anything else in this file.
 */

export type { Role };

export interface AuthUserRecord {
  id: string;
  tenantId: string;
  email: string;
  role: Role;
  passwordHash: string;
  /** AES-256-GCM ciphertext (see mfa-secret-crypto.ts), never plaintext —
   * this closes the "plain text at rest" gap db/migrations/0003 originally
   * flagged. Encrypt with encryptMfaSecret() before ever passing a record to
   * store.save(); decrypt with decryptMfaSecret() only at the point of
   * verifying a TOTP code, never log or return the decrypted value. */
  mfaSecret?: string;
  mfaEnabled: boolean;
}

export interface AuthUserStore {
  findByEmail(tenantId: string, email: string): Promise<AuthUserRecord | null>;
  /**
   * Takes tenantId, not just an id — same class of gap as
   * ConsentStore.revoke()/RatingStore.updateStatus(), found while building
   * the Postgres-backed store: an id-only signature has no tenant to scope
   * app.current_tenant_id to, so a real RLS-enforced SELECT would see
   * nothing at all rather than the intended row.
   */
  findById(tenantId: string, id: string): Promise<AuthUserRecord | null>;
  /** Insert or fully replace a user record — used by both register() and
   * the MFA enrollment methods below. */
  save(user: AuthUserRecord): Promise<void>;
}

/** Backs refresh-token rotation/revocation (see refresh() and logout()
 * below) — tracks which issued refresh tokens (by jti) must no longer be
 * honored, even though they haven't reached their JWT `exp` yet.
 *
 * Takes tenantId (and, for revoke(), userId + expiresAt), not just a jti —
 * same class of gap as ConsentStore.revoke()/RatingStore.updateStatus()/
 * AuthUserStore.findById(), found while building the Postgres-backed
 * implementation: db/migrations/0004's revoked_refresh_token table has RLS
 * and NOT NULL tenant_id/user_id columns, so a jti-only signature has
 * nothing to scope app.current_tenant_id to (isRevoked would see nothing at
 * all) or to satisfy the table's own constraints (revoke's INSERT would be
 * rejected outright). Both values are already sitting in the verified JWT
 * payload at every call site — see refresh() and logout() below — so this
 * costs callers nothing. */
export interface RevokedRefreshTokenStore {
  isRevoked(tenantId: string, jti: string): Promise<boolean>;
  revoke(tenantId: string, userId: string, jti: string, expiresAt: Date): Promise<void>;
}

export class InvalidCredentialsError extends Error {
  constructor() {
    // Deliberately identical message/type for "no such user" and "wrong
    // password" — distinguishing them would let a caller enumerate which
    // emails are registered.
    super("Invalid email or password");
    this.name = "InvalidCredentialsError";
  }
}

export class MfaEnrollmentRequiredError extends Error {
  /** `enrollmentToken` is only ever set on the login()-thrown instance of
   * this error (see this file's own "REAL BUG found 2026-09-10" comment,
   * near MfaEnrollmentTokenPayload) — confirmMfaEnrollment()'s own throw
   * site for a user who never started enrollment has no token to hand back,
   * since that caller is already authenticated by definition. */
  constructor(
    public readonly userId: string,
    public readonly enrollmentToken?: string
  ) {
    super("Owner and administrative accounts must enroll MFA before signing in");
    this.name = "MfaEnrollmentRequiredError";
  }
}

export class MfaRequiredError extends Error {
  constructor(public readonly userId: string) {
    super("MFA code required to complete sign-in");
    this.name = "MfaRequiredError";
  }
}

export class MfaInvalidCodeError extends Error {
  constructor() {
    super("Invalid MFA code");
    this.name = "MfaInvalidCodeError";
  }
}

export class EmailAlreadyRegisteredError extends Error {
  constructor(email: string) {
    super(`An account with email "${email}" already exists for this tenant`);
    this.name = "EmailAlreadyRegisteredError";
  }
}

export class WeakPasswordError extends Error {
  constructor(minLength: number) {
    super(`Password must be at least ${minLength} characters`);
    this.name = "WeakPasswordError";
  }
}

export class UserNotFoundError extends Error {
  constructor(userId: string) {
    super(`No user found with id "${userId}"`);
    this.name = "UserNotFoundError";
  }
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

interface AccessTokenPayload extends JwtPayloadBase {
  sub: string;
  tenantId: string;
  role: Role;
  type: "access";
}

interface RefreshTokenPayload extends JwtPayloadBase {
  sub: string;
  tenantId: string;
  type: "refresh";
  /** Unique per issued refresh token — what rotation/revocation actually
   * tracks. Without this, revoking "a" refresh token would mean revoking
   * every token this user has ever been issued (no way to name just one). */
  jti: string;
}

/**
 * REAL BUG found 2026-09-10 by actually driving tenant self-service
 * onboarding through the real HTTP API end to end (not just unit tests
 * calling AuthService methods directly, which is all that ever exercised
 * this path before): a freshly self-registered owner (POST /auth/tenants)
 * had NO way to complete MFA enrollment. login() correctly refuses to issue
 * any token before MFA is enrolled (throwing MfaEnrollmentRequiredError),
 * but POST /auth/mfa/enroll/start itself sits behind AccessTokenGuard,
 * which needs... an access token. A brand-new owner is locked out of their
 * own account by design, not by accident — every existing MFA test called
 * `authService.startMfaEnrollment()` directly, skipping the HTTP guard
 * entirely, so this never surfaced until a real curl-driven walkthrough hit
 * the real 401.
 *
 * FIX: `MfaEnrollmentRequiredError` now carries a short-lived, narrowly-
 * scoped `enrollmentToken` (10 minutes — just enough to complete enrollment
 * right after registering, not a standing credential) that
 * `MfaEnrollmentOrAccessTokenGuard` (not `AccessTokenGuard`) accepts on the
 * two enroll endpoints specifically. It carries the same identity as a real
 * access token and cannot be used anywhere else — `verifyAccessToken()`
 * still rejects it (wrong `type`), so it grants no access beyond finishing
 * enrollment. A staff member who already has a normal access token (MFA is
 * optional for them) can still use these same two endpoints exactly as
 * before; the guard accepts either token type.
 */
interface MfaEnrollmentTokenPayload extends JwtPayloadBase {
  sub: string;
  tenantId: string;
  role: Role;
  type: "mfa_enrollment";
}

const MFA_ENROLLMENT_TOKEN_TTL_SECONDS = 600;

export interface VerifiedAccessToken {
  userId: string;
  tenantId: string;
  role: Role;
}

/**
 * The safe-to-return subset of AuthUserRecord — no passwordHash, no
 * mfaSecret (encrypted or not, it still has no business leaving the
 * server). register() returns this, not the full record: caught live, by
 * actually calling the endpoint, that the obvious `return user` leaked the
 * password hash straight into the HTTP response body — the same class of
 * bug as MoPay's getSession originally leaking its API key, and fixed the
 * same way, at the service layer so no future caller can reintroduce it by
 * forgetting to filter the response themselves.
 */
export interface PublicAuthUserRecord {
  id: string;
  tenantId: string;
  email: string;
  role: Role;
  mfaEnabled: boolean;
}

export interface MfaEnrollmentStart {
  /** Plaintext, base32-encoded — shown to the user (as text or a QR code)
   * exactly once, at enrollment time. Never returned or logged again after
   * this; only the encrypted form is ever persisted. */
  secret: string;
  /** Standard otpauth:// URI — most authenticator apps can scan this
   * directly as a QR code. */
  otpauthUrl: string;
}

const ACCESS_TOKEN_TTL_SECONDS = 15 * 60; // "short-lived" per Master Plan Section 10
const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;
const MIN_PASSWORD_LENGTH = 8; // NIST 800-63B: prioritize length, not character-class rules

@Injectable()
export class AuthService {
  constructor(
    @Inject(AUTH_USER_STORE) private readonly store: AuthUserStore,
    @Inject(JWT_SECRET) private readonly jwtSecret: string,
    @Inject(REVOKED_REFRESH_TOKEN_STORE) private readonly revokedTokens: RevokedRefreshTokenStore,
    @Inject(MFA_ENCRYPTION_KEY) private readonly mfaEncryptionKey: string
  ) {}

  /**
   * tenantId/role are trusted as given at this layer, same as
   * startMfaEnrollment() above — what makes that safe is the caller:
   * AuthController's /auth/register route sits behind AccessTokenGuard plus
   * rbac.ts's authorize() against 'user:manage', so only an authenticated
   * owner, inviting into their own tenant, can reach this method at all. A
   * future direct caller of this method (a tenant-provisioning/bootstrap
   * flow, say) would need its own authorization story before calling this
   * with an unauthenticated caller's input.
   */
  async register(tenantId: string, email: string, password: string, role: Role, id: string): Promise<PublicAuthUserRecord> {
    if (password.length < MIN_PASSWORD_LENGTH) {
      throw new WeakPasswordError(MIN_PASSWORD_LENGTH);
    }
    const existing = await this.store.findByEmail(tenantId, email);
    if (existing) {
      throw new EmailAlreadyRegisteredError(email);
    }
    const user: AuthUserRecord = {
      id,
      tenantId,
      email,
      role,
      passwordHash: await hashPassword(password),
      mfaEnabled: false,
    };
    await this.store.save(user);
    return { id: user.id, tenantId: user.tenantId, email: user.email, role: user.role, mfaEnabled: user.mfaEnabled };
  }

  /**
   * Master Plan Section 10: "Multi-factor authentication required for
   * Owner-level and any administrative accounts." Enforced here — not left
   * as a frontend-only check a caller could bypass by calling this API
   * directly.
   */
  async login(tenantId: string, email: string, password: string, totpCode?: string): Promise<TokenPair> {
    const user = await this.store.findByEmail(tenantId, email);
    if (!user) throw new InvalidCredentialsError();

    const passwordOk = await verifyPassword(password, user.passwordHash);
    if (!passwordOk) throw new InvalidCredentialsError();

    if (user.role === "owner") {
      if (!user.mfaEnabled || !user.mfaSecret) {
        const enrollmentToken = signJwt<Omit<MfaEnrollmentTokenPayload, "iat" | "exp">>(
          { sub: user.id, tenantId: user.tenantId, role: user.role, type: "mfa_enrollment" },
          this.jwtSecret,
          MFA_ENROLLMENT_TOKEN_TTL_SECONDS
        );
        throw new MfaEnrollmentRequiredError(user.id, enrollmentToken);
      }
      if (!totpCode) {
        throw new MfaRequiredError(user.id);
      }
      const decryptedSecret = decryptMfaSecret(user.mfaSecret, this.mfaEncryptionKey);
      if (!verifyTotp(decryptedSecret, totpCode)) {
        throw new MfaInvalidCodeError();
      }
    }

    return this.issueTokenPair(user);
  }

  /**
   * Step 1 of MFA enrollment: generates a fresh secret, persists it
   * encrypted with mfaEnabled still false (so a login can't accidentally
   * start requiring a code the user hasn't confirmed they can actually
   * generate yet), and returns the plaintext secret + an otpauth:// URI for
   * display. Must be followed by confirmMfaEnrollment() with a code
   * generated from that secret before MFA actually takes effect.
   *
   * tenantId/userId are trusted as given at this layer — this method itself
   * has no way to know who's calling. What makes that safe is the caller:
   * AuthController's /auth/mfa/enroll/start route sits behind
   * AccessTokenGuard, which derives these two values from the caller's own
   * verified access token, never from request-body input. A future caller
   * of this method (e.g. an admin "reset a teammate's MFA" flow) would need
   * its own authorization check before calling this with someone else's id.
   */
  async startMfaEnrollment(tenantId: string, userId: string): Promise<MfaEnrollmentStart> {
    const user = await this.store.findById(tenantId, userId);
    if (!user) throw new UserNotFoundError(userId);

    const secret = generateBase32Secret();
    await this.store.save({ ...user, mfaSecret: encryptMfaSecret(secret, this.mfaEncryptionKey), mfaEnabled: false });

    const otpauthUrl = `otpauth://totp/Mytrima:${encodeURIComponent(user.email)}?secret=${secret}&issuer=Mytrima&algorithm=SHA1&digits=6&period=30`;
    return { secret, otpauthUrl };
  }

  /**
   * Step 2: proves the user actually captured the secret correctly (their
   * authenticator app produces a valid current code) before MFA is switched
   * on. Only after this succeeds does login() start requiring a code.
   */
  async confirmMfaEnrollment(tenantId: string, userId: string, code: string): Promise<void> {
    const user = await this.store.findById(tenantId, userId);
    if (!user) throw new UserNotFoundError(userId);
    if (!user.mfaSecret) {
      throw new MfaEnrollmentRequiredError(userId);
    }
    const decryptedSecret = decryptMfaSecret(user.mfaSecret, this.mfaEncryptionKey);
    if (!verifyTotp(decryptedSecret, code)) {
      throw new MfaInvalidCodeError();
    }
    await this.store.save({ ...user, mfaEnabled: true });
  }

  /**
   * Exchanges a valid, unexpired, unrevoked refresh token for a new
   * access+refresh pair. Rejects an access token presented here — the two
   * token types must not be interchangeable, or a leaked access token would
   * be as dangerous as a leaked refresh token.
   *
   * Rotates on every use: the refresh token just spent is immediately
   * revoked and a brand new one (with a new jti) is issued in its place.
   * This closes a real gap the single-use-refresh-token pattern exists to
   * prevent — a leaked-but-not-yet-used refresh token being replayable
   * indefinitely. If a caller ever presents an already-used (and thus
   * revoked) refresh token, that's a strong signal of a leaked token, not
   * just an expired one — treated the same as any other invalid token here,
   * but a production system should alert on this case specifically.
   */
  async refresh(refreshToken: string): Promise<TokenPair> {
    const payload = verifyJwt<RefreshTokenPayload>(refreshToken, this.jwtSecret);
    if (payload.type !== "refresh") {
      throw new InvalidTokenError("Not a refresh token");
    }
    if (await this.revokedTokens.isRevoked(payload.tenantId, payload.jti)) {
      throw new InvalidTokenError("Refresh token has been revoked");
    }
    const user = await this.store.findById(payload.tenantId, payload.sub);
    if (!user) throw new InvalidCredentialsError();

    await this.revokedTokens.revoke(payload.tenantId, payload.sub, payload.jti, new Date(payload.exp * 1000));
    return this.issueTokenPair(user);
  }

  /** Explicit "log out this session" — revokes a specific refresh token
   * before it would naturally expire. Verifies the token is at least
   * well-formed and unexpired first, so this can't be used to poison the
   * revocation store with arbitrary garbage jtis. */
  async logout(refreshToken: string): Promise<void> {
    const payload = verifyJwt<RefreshTokenPayload>(refreshToken, this.jwtSecret);
    if (payload.type !== "refresh") {
      throw new InvalidTokenError("Not a refresh token");
    }
    await this.revokedTokens.revoke(payload.tenantId, payload.sub, payload.jti, new Date(payload.exp * 1000));
  }

  /** Verifies an access token and returns the identity/role to authorize
   * against (see rbac.ts). Rejects a refresh token presented here, for the
   * same reason refresh() rejects an access token. */
  verifyAccessToken(accessToken: string): VerifiedAccessToken {
    const payload = verifyJwt<AccessTokenPayload>(accessToken, this.jwtSecret);
    if (payload.type !== "access") {
      throw new InvalidTokenError("Not an access token");
    }
    return { userId: payload.sub, tenantId: payload.tenantId, role: payload.role };
  }

  /** Used only by MfaEnrollmentOrAccessTokenGuard, only on the two MFA
   * enrollment endpoints — see this file's own "REAL BUG found 2026-09-10"
   * comment for why a real access token alone can't cover both callers who
   * legitimately need this (a fresh owner with no access token yet, and an
   * already-logged-in staff member optionally self-enrolling). Rejects
   * every other token type, including a real refresh token — this is
   * deliberately not "accept anything," just "accept one more narrow case." */
  verifyAccessOrMfaEnrollmentToken(token: string): VerifiedAccessToken {
    const payload = verifyJwt<(AccessTokenPayload | MfaEnrollmentTokenPayload) & { type: string }>(token, this.jwtSecret);
    if (payload.type !== "access" && payload.type !== "mfa_enrollment") {
      throw new InvalidTokenError("Token must be a real access token or a short-lived MFA-enrollment token");
    }
    return { userId: payload.sub, tenantId: payload.tenantId, role: payload.role };
  }

  private issueTokenPair(user: AuthUserRecord): TokenPair {
    const accessToken = signJwt<Omit<AccessTokenPayload, "iat" | "exp">>(
      { sub: user.id, tenantId: user.tenantId, role: user.role, type: "access" },
      this.jwtSecret,
      ACCESS_TOKEN_TTL_SECONDS
    );
    const refreshToken = signJwt<Omit<RefreshTokenPayload, "iat" | "exp">>(
      { sub: user.id, tenantId: user.tenantId, type: "refresh", jti: crypto.randomUUID() },
      this.jwtSecret,
      REFRESH_TOKEN_TTL_SECONDS
    );
    return { accessToken, refreshToken };
  }
}

/** NestJS DI tokens for AdminAuthService's dependencies with no usable
 * runtime type for Nest to infer automatically. JWT_SECRET/MFA_ENCRYPTION_KEY
 * are deliberately NOT redefined here — AdminAuthModule re-provides the
 * exact same Symbols from ../auth/auth.tokens.ts (both resolving the same
 * env vars), the same "re-declared locally" pattern already used
 * throughout this codebase for AccessTokenGuard, rather than importing
 * the whole AuthModule for two primitives this module otherwise has no
 * use for. */
export const ADMIN_USER_STORE = Symbol("ADMIN_USER_STORE");
export const ADMIN_REVOKED_REFRESH_TOKEN_STORE = Symbol("ADMIN_REVOKED_REFRESH_TOKEN_STORE");

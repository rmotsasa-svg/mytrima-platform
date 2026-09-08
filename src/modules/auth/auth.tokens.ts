/** NestJS DI tokens for AuthService's dependencies that have no usable
 * runtime type for Nest to infer automatically: two interfaces (AuthUserStore,
 * RevokedRefreshTokenStore) and two primitives (the JWT secret, the MFA
 * secret encryption key). */
export const AUTH_USER_STORE = Symbol("AUTH_USER_STORE");
export const JWT_SECRET = Symbol("JWT_SECRET");
export const REVOKED_REFRESH_TOKEN_STORE = Symbol("REVOKED_REFRESH_TOKEN_STORE");
export const MFA_ENCRYPTION_KEY = Symbol("MFA_ENCRYPTION_KEY");

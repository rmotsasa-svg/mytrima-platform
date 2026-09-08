import crypto from "node:crypto";

/**
 * Minimal HMAC-SHA256 JWT sign/verify, hand-rolled on Node's built-in
 * `crypto` module rather than pulling in `jsonwebtoken` — this scaffold has
 * no npm registry dependency beyond typescript+tsx (see README). Implements
 * exactly the subset of the JWT spec (RFC 7519) this platform needs: HS256
 * signing, `exp` expiry, no `alg: none` support (that JWT footgun is simply
 * not implemented, not merely disabled), and no support for verifying a
 * token signed with a different algorithm than HS256.
 */

export class InvalidTokenError extends Error {
  constructor(message = "Invalid token") {
    super(message);
    this.name = "InvalidTokenError";
  }
}

export class TokenExpiredError extends Error {
  constructor(message = "Token expired") {
    super(message);
    this.name = "TokenExpiredError";
  }
}

interface JwtHeader {
  alg: "HS256";
  typ: "JWT";
}

export interface JwtPayloadBase {
  iat: number;
  exp: number;
}

function base64url(input: Buffer): string {
  return input.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64urlDecode(input: string): Buffer {
  const padded = input + "=".repeat((4 - (input.length % 4)) % 4);
  return Buffer.from(padded.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

/** Signs `payload` plus `iat`/`exp` claims, expiring `expiresInSeconds` from now. */
export function signJwt<T extends object>(payload: T, secret: string, expiresInSeconds: number): string {
  const header: JwtHeader = { alg: "HS256", typ: "JWT" };
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + expiresInSeconds;
  const fullPayload = { ...payload, iat, exp };

  const headerB64 = base64url(Buffer.from(JSON.stringify(header)));
  const payloadB64 = base64url(Buffer.from(JSON.stringify(fullPayload)));
  const signature = crypto.createHmac("sha256", secret).update(`${headerB64}.${payloadB64}`).digest();

  return `${headerB64}.${payloadB64}.${base64url(signature)}`;
}

/** Verifies signature and expiry, then returns the decoded payload. Throws
 * InvalidTokenError for anything structurally or cryptographically wrong,
 * and TokenExpiredError specifically when the signature is valid but `exp`
 * has passed — callers that want to react differently to "expired" versus
 * "tampered/garbage" can rely on that distinction. */
export function verifyJwt<T extends JwtPayloadBase>(token: string, secret: string): T {
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new InvalidTokenError("Malformed token: expected 3 dot-separated parts");
  }
  const [headerB64, payloadB64, signatureB64] = parts;

  let actualSignature: Buffer;
  try {
    actualSignature = base64urlDecode(signatureB64);
  } catch {
    throw new InvalidTokenError("Malformed token: signature is not valid base64url");
  }

  const expectedSignature = crypto.createHmac("sha256", secret).update(`${headerB64}.${payloadB64}`).digest();
  if (actualSignature.length !== expectedSignature.length || !crypto.timingSafeEqual(actualSignature, expectedSignature)) {
    throw new InvalidTokenError("Signature mismatch");
  }

  let header: JwtHeader;
  let payload: T;
  try {
    header = JSON.parse(base64urlDecode(headerB64).toString("utf-8"));
    payload = JSON.parse(base64urlDecode(payloadB64).toString("utf-8"));
  } catch {
    throw new InvalidTokenError("Malformed token: header/payload is not valid JSON");
  }
  if (header.alg !== "HS256") {
    throw new InvalidTokenError(`Unsupported algorithm: ${header.alg}`);
  }

  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== "number" || payload.exp <= now) {
    throw new TokenExpiredError();
  }

  return payload;
}

import crypto from "node:crypto";

/**
 * Closes the "MFA secret stored as plain text" gap flagged in
 * db/migrations/0003_auth_mfa_secret.sql and auth.service.ts: this encrypts
 * a TOTP secret before it's ever handed to a store's save(), using AES-256-
 * GCM (authenticated encryption — a tampered ciphertext fails to decrypt
 * rather than silently returning garbage). Hand-rolled on Node's built-in
 * `crypto`, same reasoning as password.ts/jwt.ts/totp.ts: a real,
 * defensible choice, not a placeholder for a library.
 *
 * IMPORTANT: this only closes the *application-layer* half of the gap. The
 * encryption key itself still has to live somewhere real — a secrets
 * manager, per Master Plan Section 10 — not a hardcoded fallback. See
 * auth.module.ts's MFA_ENCRYPTION_KEY provider for the same dev-only-
 * fallback pattern already used for JWT_SECRET, with the same caveat.
 */

const ALGORITHM = "aes-256-gcm";
const KEY_LENGTH_BYTES = 32; // AES-256
const IV_LENGTH_BYTES = 12; // 96-bit IV is the GCM-recommended size
const AUTH_TAG_LENGTH_BYTES = 16;

export class InvalidMfaEncryptionKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidMfaEncryptionKeyError";
  }
}

export class MfaSecretDecryptionError extends Error {
  constructor() {
    super("Failed to decrypt MFA secret — the encryption key is wrong, or the stored value was tampered with or corrupted");
    this.name = "MfaSecretDecryptionError";
  }
}

function keyFromBase64(keyBase64: string): Buffer {
  const key = Buffer.from(keyBase64, "base64");
  if (key.length !== KEY_LENGTH_BYTES) {
    throw new InvalidMfaEncryptionKeyError(`MFA encryption key must decode to exactly ${KEY_LENGTH_BYTES} bytes, got ${key.length}`);
  }
  return key;
}

/** Generates a fresh, random base64-encoded 256-bit key — use this once to
 * populate the MFA_ENCRYPTION_KEY environment variable, not at request time. */
export function generateMfaEncryptionKey(): string {
  return crypto.randomBytes(KEY_LENGTH_BYTES).toString("base64");
}

/** Returns a single base64 string (IV + auth tag + ciphertext concatenated)
 * so the encrypted value round-trips through a single text column. */
export function encryptMfaSecret(plaintextSecret: string, keyBase64: string): string {
  const key = keyFromBase64(keyBase64);
  const iv = crypto.randomBytes(IV_LENGTH_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintextSecret, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]).toString("base64");
}

export function decryptMfaSecret(encryptedBase64: string, keyBase64: string): string {
  const key = keyFromBase64(keyBase64);
  const data = Buffer.from(encryptedBase64, "base64");
  const iv = data.subarray(0, IV_LENGTH_BYTES);
  const authTag = data.subarray(IV_LENGTH_BYTES, IV_LENGTH_BYTES + AUTH_TAG_LENGTH_BYTES);
  const ciphertext = data.subarray(IV_LENGTH_BYTES + AUTH_TAG_LENGTH_BYTES);
  try {
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return plaintext.toString("utf8");
  } catch {
    // GCM's auth-tag check throws on any mismatch (wrong key OR tampered
    // ciphertext) — normalized to one clear error rather than leaking
    // Node's raw OpenSSL error string.
    throw new MfaSecretDecryptionError();
  }
}

import crypto from "node:crypto";

/**
 * Password hashing via Node's built-in `crypto.scrypt` — deliberately no
 * external dependency (bcrypt/argon2). scrypt is a memory-hard KDF that ships
 * in Node core, which matches this scaffold's "no npm registry access
 * assumed" constraint (see README) while still being a defensible choice for
 * a pilot-scale platform, not a corner cut. Revisit only if a specific
 * compliance requirement (e.g. a client mandate for argon2id) ever demands
 * it — nothing in the Master Plan currently does.
 */

const KEY_LENGTH = 64;
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1 }; // Node's own documented defaults

export class MalformedPasswordHashError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MalformedPasswordHashError";
  }
}

function scryptAsync(password: string, salt: Buffer, keylen: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, keylen, SCRYPT_PARAMS, (err: Error | null, derivedKey: Buffer) => {
      if (err) reject(err);
      else resolve(derivedKey);
    });
  });
}

/** Returns "saltHex:hashHex" — a fresh random salt every call, so hashing the
 * same password twice produces two different stored values. */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const hash = await scryptAsync(password, salt, KEY_LENGTH);
  return `${salt.toString("hex")}:${hash.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split(":");
  if (parts.length !== 2) {
    throw new MalformedPasswordHashError(`Expected "salt:hash", got a value with ${parts.length} colon-separated part(s)`);
  }
  const [saltHex, hashHex] = parts;
  const salt = Buffer.from(saltHex, "hex");
  const expected = Buffer.from(hashHex, "hex");
  const actual = await scryptAsync(password, salt, expected.length);
  // Constant-time comparison: a length check before timingSafeEqual is safe
  // because expected.length depends only on the stored hash, not on the
  // caller-supplied password.
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

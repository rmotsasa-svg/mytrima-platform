import crypto from "node:crypto";

/**
 * TOTP (RFC 6238, built on HOTP/RFC 4226) for Owner-level MFA, per Master
 * Plan Section 10: "Multi-factor authentication required for Owner-level and
 * any administrative accounts." Hand-rolled on Node's built-in `crypto`
 * rather than an `otplib`-style dependency — same no-registry-dependency
 * reasoning as jwt.ts and password.ts. Uses HMAC-SHA1 and 30-second steps,
 * which is what every mainstream authenticator app (Google Authenticator,
 * Authy, 1Password, etc.) assumes by default — a different algorithm/step
 * would work correctly against this code but silently fail against those
 * apps, so this is a compatibility choice, not an arbitrary one.
 */

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return output;
}

export function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/=+$/, "");
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of clean) {
    const idx = BASE32_ALPHABET.indexOf(char);
    if (idx === -1) throw new Error(`Invalid base32 character: "${char}"`);
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

export function generateBase32Secret(byteLength = 20): string {
  return base32Encode(crypto.randomBytes(byteLength));
}

/** RFC 4226 HOTP: an HMAC-SHA1-based one-time code for a given counter value. */
export function hotp(secretBytes: Buffer, counter: number, digits = 6): string {
  const counterBuf = Buffer.alloc(8);
  counterBuf.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac("sha1", secretBytes).update(counterBuf).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const binCode =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return (binCode % 10 ** digits).toString().padStart(digits, "0");
}

/** RFC 6238 TOTP: HOTP where the counter is the number of `stepSeconds`
 * windows elapsed since the Unix epoch. */
export function totp(secretBytes: Buffer, forTimeMs: number = Date.now(), stepSeconds = 30, digits = 6): string {
  const counter = Math.floor(forTimeMs / 1000 / stepSeconds);
  return hotp(secretBytes, counter, digits);
}

export interface VerifyTotpOptions {
  forTimeMs?: number;
  stepSeconds?: number;
  digits?: number;
  /** Number of steps of clock drift to tolerate on either side. Default 1
   * (i.e. accepts the previous, current, and next 30-second code). */
  window?: number;
}

/** Verifies a user-supplied code against a base32-encoded secret (the form an
 * authenticator app's QR code/manual-entry key is in), tolerating a small
 * window of clock drift. Constant-time per candidate so a timing side
 * channel can't narrow down which step matched. */
export function verifyTotp(base32Secret: string, candidateCode: string, options: VerifyTotpOptions = {}): boolean {
  const { forTimeMs = Date.now(), stepSeconds = 30, digits = 6, window = 1 } = options;
  const secretBytes = base32Decode(base32Secret);
  const counter = Math.floor(forTimeMs / 1000 / stepSeconds);
  const candidateBuf = Buffer.from(candidateCode);

  let matched = false;
  for (let offset = -window; offset <= window; offset++) {
    const expected = hotp(secretBytes, counter + offset, digits);
    const expectedBuf = Buffer.from(expected);
    if (expectedBuf.length === candidateBuf.length && crypto.timingSafeEqual(expectedBuf, candidateBuf)) {
      matched = true;
    }
  }
  return matched;
}

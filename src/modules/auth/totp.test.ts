import { hotp, totp, verifyTotp, base32Encode, base32Decode, generateBase32Secret } from "./totp";

// RFC 6238 Appendix B official test vectors: 20-byte ASCII seed
// "12345678901234567890", HMAC-SHA1, 30-second step, 8-digit codes.
// These are published spec values, not independently derived — if this
// implementation ever disagrees with them, the implementation is wrong.
const RFC_SEED = Buffer.from("12345678901234567890", "ascii");
const RFC_VECTORS: Array<[number, string]> = [
  [59, "94287082"],
  [1111111109, "07081804"],
  [1111111111, "14050471"],
  [1234567890, "89005924"],
  [2000000000, "69279037"],
  [20000000000, "65353130"],
];

for (const [timeSeconds, expectedCode] of RFC_VECTORS) {
  test(`RFC 6238 vector: T=${timeSeconds}s produces ${expectedCode}`, () => {
    expect(totp(RFC_SEED, timeSeconds * 1000, 30, 8)).toBe(expectedCode);
  });
}

test("6-digit truncation matches the last 6 digits of the RFC's 8-digit vector at T=59", () => {
  // 94287082 mod 1_000_000 = 287082 — derived from the RFC vector above, not
  // a separately sourced value.
  expect(totp(RFC_SEED, 59_000, 30, 6)).toBe("287082");
});

test("hotp with counter 0 and counter 1 produce different codes", () => {
  expect(hotp(RFC_SEED, 0)).not.toBe(hotp(RFC_SEED, 1));
});

test("base32Encode/base32Decode round-trip arbitrary bytes", () => {
  const original = Buffer.from([0, 1, 2, 253, 254, 255, 17, 42]);
  expect(base32Decode(base32Encode(original))).toEqual(original);
});

test("generateBase32Secret produces a decodable secret of the requested byte length", () => {
  const secret = generateBase32Secret(20);
  expect(base32Decode(secret).length).toBe(20);
});

test("verifyTotp accepts the correct current code", () => {
  const secret = generateBase32Secret();
  const nowMs = Date.now();
  const validCode = totp(base32Decode(secret), nowMs);
  expect(verifyTotp(secret, validCode, { forTimeMs: nowMs })).toBe(true);
});

test("verifyTotp rejects an incorrect code", () => {
  const secret = generateBase32Secret();
  expect(verifyTotp(secret, "000000", { forTimeMs: Date.now() })).toBe(false);
});

test("verifyTotp tolerates one step of clock drift (window: 1) but not two (window: 0)", () => {
  const secret = generateBase32Secret();
  const secretBytes = base32Decode(secret);
  const nowMs = Date.now();
  const oneStepAheadMs = nowMs + 30_000;
  const codeOneStepAhead = totp(secretBytes, oneStepAheadMs);

  expect(verifyTotp(secret, codeOneStepAhead, { forTimeMs: nowMs, window: 1 })).toBe(true);
  expect(verifyTotp(secret, codeOneStepAhead, { forTimeMs: nowMs, window: 0 })).toBe(false);
});

import {
  encryptMfaSecret,
  decryptMfaSecret,
  generateMfaEncryptionKey,
  InvalidMfaEncryptionKeyError,
  MfaSecretDecryptionError,
} from "./mfa-secret-crypto";

test("encrypt then decrypt round-trips the original secret", () => {
  const key = generateMfaEncryptionKey();
  const encrypted = encryptMfaSecret("JBSWY3DPEHPK3PXP", key);
  expect(decryptMfaSecret(encrypted, key)).toBe("JBSWY3DPEHPK3PXP");
});

test("encrypting the same secret twice produces different ciphertext (random IV per call)", () => {
  const key = generateMfaEncryptionKey();
  const a = encryptMfaSecret("same-secret", key);
  const b = encryptMfaSecret("same-secret", key);
  expect(a).not.toBe(b);
  expect(decryptMfaSecret(a, key)).toBe("same-secret");
  expect(decryptMfaSecret(b, key)).toBe("same-secret");
});

test("decrypting with the wrong key throws MfaSecretDecryptionError rather than returning garbage", () => {
  const encrypted = encryptMfaSecret("a-real-secret", generateMfaEncryptionKey());
  expect(() => decryptMfaSecret(encrypted, generateMfaEncryptionKey())).toThrow(MfaSecretDecryptionError);
});

test("a tampered ciphertext fails the GCM auth tag check rather than decrypting silently", () => {
  const key = generateMfaEncryptionKey();
  const encrypted = encryptMfaSecret("a-real-secret", key);
  const bytes = Buffer.from(encrypted, "base64");
  bytes[bytes.length - 1] ^= 0xff; // flip the last ciphertext byte
  const tampered = bytes.toString("base64");
  expect(() => decryptMfaSecret(tampered, key)).toThrow(MfaSecretDecryptionError);
});

test("generateMfaEncryptionKey produces a key of the correct length, usable immediately", () => {
  const key = generateMfaEncryptionKey();
  expect(Buffer.from(key, "base64").length).toBe(32);
  const encrypted = encryptMfaSecret("test", key);
  expect(decryptMfaSecret(encrypted, key)).toBe("test");
});

test("an incorrectly-sized key throws InvalidMfaEncryptionKeyError rather than silently truncating/padding", () => {
  const tooShortKey = Buffer.from("not32bytes").toString("base64");
  expect(() => encryptMfaSecret("secret", tooShortKey)).toThrow(InvalidMfaEncryptionKeyError);
});

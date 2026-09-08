import { hashPassword, verifyPassword, MalformedPasswordHashError } from "./password";

test("verifyPassword returns true for the correct password", async () => {
  const stored = await hashPassword("correct horse battery staple");
  expect(await verifyPassword("correct horse battery staple", stored)).toBe(true);
});

test("verifyPassword returns false for an incorrect password", async () => {
  const stored = await hashPassword("correct horse battery staple");
  expect(await verifyPassword("wrong password", stored)).toBe(false);
});

test("hashing the same password twice produces different stored values (random salt), both still verify", async () => {
  const a = await hashPassword("same password");
  const b = await hashPassword("same password");
  expect(a).not.toBe(b);
  expect(await verifyPassword("same password", a)).toBe(true);
  expect(await verifyPassword("same password", b)).toBe(true);
});

test("verifyPassword throws MalformedPasswordHashError for a stored value with no salt separator", async () => {
  await expect(verifyPassword("anything", "not-a-valid-stored-hash")).rejects.toThrow(MalformedPasswordHashError);
});

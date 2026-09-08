import { signJwt, verifyJwt, InvalidTokenError, TokenExpiredError, JwtPayloadBase } from "./jwt";

interface TestPayload extends JwtPayloadBase {
  sub: string;
  role: string;
}

test("sign then verify round-trips the original payload fields", () => {
  const token = signJwt({ sub: "user-1", role: "owner" }, "secret", 3600);
  const payload = verifyJwt<TestPayload>(token, "secret");
  expect(payload.sub).toBe("user-1");
  expect(payload.role).toBe("owner");
});

test("iat and exp are set correctly from expiresInSeconds", () => {
  const before = Math.floor(Date.now() / 1000);
  const token = signJwt({ sub: "user-1" }, "secret", 100);
  const payload = verifyJwt<JwtPayloadBase & { sub: string }>(token, "secret");
  expect(payload.iat).toBeGreaterThanOrEqual(before);
  expect(payload.exp).toBe(payload.iat + 100);
});

test("verify throws InvalidTokenError for a token signed with a different secret", () => {
  const token = signJwt({ sub: "user-1" }, "secret-a", 3600);
  expect(() => verifyJwt(token, "secret-b")).toThrow(InvalidTokenError);
});

test("verify throws InvalidTokenError for a tampered payload", () => {
  const token = signJwt({ sub: "user-1", role: "read_only" }, "secret", 3600);
  const [header, , signature] = token.split(".");
  const tamperedPayload = Buffer.from(JSON.stringify({ sub: "user-1", role: "owner", iat: 0, exp: 9999999999 }))
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  const tamperedToken = `${header}.${tamperedPayload}.${signature}`;
  expect(() => verifyJwt(tamperedToken, "secret")).toThrow(InvalidTokenError);
});

test("verify throws InvalidTokenError for a malformed token (wrong number of parts)", () => {
  expect(() => verifyJwt("not.a.jwt.at.all", "secret")).toThrow(InvalidTokenError);
  expect(() => verifyJwt("onlyonepart", "secret")).toThrow(InvalidTokenError);
});

test("verify throws TokenExpiredError for an already-expired token", () => {
  const token = signJwt({ sub: "user-1" }, "secret", -1);
  expect(() => verifyJwt(token, "secret")).toThrow(TokenExpiredError);
});

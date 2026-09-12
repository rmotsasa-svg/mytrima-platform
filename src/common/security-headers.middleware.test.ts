import type { Request, Response, NextFunction } from "express";
import { securityHeaders } from "./security-headers.middleware";

function fakeResponse(): Response {
  const headers: Record<string, string> = {};
  return {
    removeHeader: jest.fn((name: string) => delete headers[name]),
    setHeader: jest.fn((name: string, value: string) => {
      headers[name] = value;
    }),
    getHeader: (name: string) => headers[name],
  } as unknown as Response;
}

test("removes X-Powered-By and sets every expected security header, then calls next()", () => {
  const res = fakeResponse();
  const next = jest.fn() as NextFunction;

  securityHeaders({} as Request, res, next);

  expect(res.removeHeader).toHaveBeenCalledWith("X-Powered-By");
  expect(res.setHeader).toHaveBeenCalledWith("X-Content-Type-Options", "nosniff");
  expect(res.setHeader).toHaveBeenCalledWith("X-Frame-Options", "DENY");
  expect(res.setHeader).toHaveBeenCalledWith("Referrer-Policy", "strict-origin-when-cross-origin");
  expect(res.setHeader).toHaveBeenCalledWith("Strict-Transport-Security", expect.stringContaining("max-age="));
  expect(res.setHeader).toHaveBeenCalledWith("X-Permitted-Cross-Domain-Policies", "none");
  expect(res.setHeader).toHaveBeenCalledWith("Permissions-Policy", expect.stringContaining("camera=()"));
  expect(next).toHaveBeenCalledTimes(1);
});

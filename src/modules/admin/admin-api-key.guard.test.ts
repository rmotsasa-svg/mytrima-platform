import { ExecutionContext } from "@nestjs/common";
import type { Request } from "express";
import { AdminApiKeyGuard, AdminApiKeyNotConfiguredError, InvalidAdminApiKeyError } from "./admin-api-key.guard";

function makeContext(headers: Record<string, string>): ExecutionContext {
  const request = { headers } as unknown as Request;
  return {
    switchToHttp: () => ({ getRequest: () => request, getResponse: () => ({}), getNext: () => undefined }),
  } as unknown as ExecutionContext;
}

const originalEnv = process.env.ADMIN_API_KEY;
afterEach(() => {
  process.env.ADMIN_API_KEY = originalEnv;
});

test("throws AdminApiKeyNotConfiguredError when ADMIN_API_KEY is unset — fails closed, not open", () => {
  delete process.env.ADMIN_API_KEY;
  const guard = new AdminApiKeyGuard();
  expect(() => guard.canActivate(makeContext({ "x-admin-api-key": "anything" }))).toThrow(AdminApiKeyNotConfiguredError);
});

test("throws InvalidAdminApiKeyError when the provided header doesn't match", () => {
  process.env.ADMIN_API_KEY = "the-real-key";
  const guard = new AdminApiKeyGuard();
  expect(() => guard.canActivate(makeContext({ "x-admin-api-key": "wrong-key" }))).toThrow(InvalidAdminApiKeyError);
});

test("throws InvalidAdminApiKeyError when no header is provided at all", () => {
  process.env.ADMIN_API_KEY = "the-real-key";
  const guard = new AdminApiKeyGuard();
  expect(() => guard.canActivate(makeContext({}))).toThrow(InvalidAdminApiKeyError);
});

test("passes silently when the provided header matches", () => {
  process.env.ADMIN_API_KEY = "the-real-key";
  const guard = new AdminApiKeyGuard();
  expect(guard.canActivate(makeContext({ "x-admin-api-key": "the-real-key" }))).toBe(true);
});

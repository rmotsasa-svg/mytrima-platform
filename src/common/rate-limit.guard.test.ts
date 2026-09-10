import "reflect-metadata";
import { ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import { RateLimitGuard, RateLimitExceededError } from "./rate-limit.guard";
import { RATE_LIMIT_KEY, RateLimitOptions } from "./rate-limit.decorator";

/** Fake ExecutionContext exposing exactly what RateLimitGuard reads:
 * getHandler()/getClass() (for the Reflector lookup + per-route cache key)
 * and switchToHttp().getRequest() (for the client's IP). Real Reflector is
 * used, not mocked — Reflector.get() just reads metadata SetMetadata
 * attaches to the handler function, which this fake sets up directly. */
function makeContext(request: Partial<Request>, rateLimit?: RateLimitOptions, handlerName = "testHandler"): ExecutionContext {
  const handler = function testHandler() {};
  Object.defineProperty(handler, "name", { value: handlerName });
  if (rateLimit) Reflect.defineMetadata(RATE_LIMIT_KEY, rateLimit, handler);

  class TestController {}

  return {
    getHandler: () => handler,
    getClass: () => TestController,
    switchToHttp: () => ({
      getRequest: () => request as Request,
      getResponse: () => ({}),
      getNext: () => undefined,
    }),
  } as unknown as ExecutionContext;
}

test("allows a request through when the handler has no @RateLimit() metadata at all", () => {
  const guard = new RateLimitGuard(new Reflector());
  const context = makeContext({ ip: "1.2.3.4" }); // no rateLimit options given
  expect(guard.canActivate(context)).toBe(true);
});

test("allows requests up to the configured max within the window", () => {
  const guard = new RateLimitGuard(new Reflector());
  const options: RateLimitOptions = { max: 3, windowMs: 60_000 };
  for (let i = 0; i < 3; i++) {
    expect(guard.canActivate(makeContext({ ip: "1.2.3.4" }, options))).toBe(true);
  }
});

test("throws RateLimitExceededError once the max is exceeded within the window", () => {
  const guard = new RateLimitGuard(new Reflector());
  const options: RateLimitOptions = { max: 2, windowMs: 60_000 };
  const ctx = () => makeContext({ ip: "1.2.3.4" }, options);
  expect(guard.canActivate(ctx())).toBe(true);
  expect(guard.canActivate(ctx())).toBe(true);
  expect(() => guard.canActivate(ctx())).toThrow(RateLimitExceededError);
});

test("tracks each client IP separately — one IP being limited doesn't affect another", () => {
  const guard = new RateLimitGuard(new Reflector());
  const options: RateLimitOptions = { max: 1, windowMs: 60_000 };
  expect(guard.canActivate(makeContext({ ip: "1.1.1.1" }, options))).toBe(true);
  expect(() => guard.canActivate(makeContext({ ip: "1.1.1.1" }, options))).toThrow(RateLimitExceededError);
  // A different IP hitting the SAME handler is unaffected by 1.1.1.1's limit.
  expect(guard.canActivate(makeContext({ ip: "2.2.2.2" }, options))).toBe(true);
});

test("tracks each handler separately — being limited on one route doesn't affect a different route for the same client", () => {
  const guard = new RateLimitGuard(new Reflector());
  const options: RateLimitOptions = { max: 1, windowMs: 60_000 };
  expect(guard.canActivate(makeContext({ ip: "1.1.1.1" }, options, "routeA"))).toBe(true);
  expect(() => guard.canActivate(makeContext({ ip: "1.1.1.1" }, options, "routeA"))).toThrow(RateLimitExceededError);
  expect(guard.canActivate(makeContext({ ip: "1.1.1.1" }, options, "routeB"))).toBe(true);
});

test("falls back to the socket's remote address when request.ip is unavailable", () => {
  const guard = new RateLimitGuard(new Reflector());
  const options: RateLimitOptions = { max: 1, windowMs: 60_000 };
  const request = { socket: { remoteAddress: "3.3.3.3" } } as unknown as Request;
  expect(guard.canActivate(makeContext(request, options))).toBe(true);
  expect(() => guard.canActivate(makeContext(request, options))).toThrow(RateLimitExceededError);
});

test("a request outside the window (simulated via a fresh guard instance) is allowed again — the sliding window actually expires old hits", () => {
  // Rather than sleeping in a test, this directly proves the window-filter
  // logic: hits older than windowMs are excluded from the count, by using
  // an already-past timestamp path — the guard filters on Date.now()
  // internally, so a 1ms window with a tiny pause is the practical way to
  // observe expiry without a real sleep.
  jest.useFakeTimers();
  const guard = new RateLimitGuard(new Reflector());
  const options: RateLimitOptions = { max: 1, windowMs: 1000 };
  const ctx = () => makeContext({ ip: "4.4.4.4" }, options);
  expect(guard.canActivate(ctx())).toBe(true);
  expect(() => guard.canActivate(ctx())).toThrow(RateLimitExceededError);
  jest.advanceTimersByTime(1001);
  expect(guard.canActivate(ctx())).toBe(true);
  jest.useRealTimers();
});

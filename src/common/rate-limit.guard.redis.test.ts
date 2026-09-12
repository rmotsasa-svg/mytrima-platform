import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import IORedis from "ioredis";
import type { Request } from "express";
import { RATE_LIMIT_KEY, RateLimitOptions } from "./rate-limit.decorator";

/**
 * REAL integration test against a live Redis-compatible server — gated
 * behind TEST_REDIS_URL, same pattern as
 * notification-worker.service.test.ts's own real enqueue -> Redis ->
 * worker pipeline test. Proves the one thing rate-limit.guard.test.ts's
 * in-memory-only tests structurally cannot: that two separate
 * RateLimitGuard instances (standing in for two separate app processes,
 * each with its own private `hitsByKey` Map) actually share rate-limit
 * state once REDIS_URL is set — the real fix this file's own 2026-09-12
 * update made.
 *
 * `REDIS_URL` (not `TEST_REDIS_URL`) is what rate-limit.guard.ts's own
 * getSharedRedisClient() actually reads, and that client is cached at
 * module scope on first use — set before importing RateLimitGuard, in a
 * dynamic import inside beforeAll, so this file's own import order
 * doesn't race a cached `null` from any other test file that happened to
 * load rate-limit.guard.ts first with REDIS_URL still unset. Jest gives
 * each test FILE its own module registry by default, so this isolation
 * holds without any extra setup.
 */
const TEST_REDIS_URL = process.env.TEST_REDIS_URL;
const maybeDescribe = TEST_REDIS_URL ? describe : describe.skip;

function makeContext(request: Partial<Request>, rateLimit: RateLimitOptions, handlerName: string): ExecutionContext {
  const handler = function testHandler() {};
  Object.defineProperty(handler, "name", { value: handlerName });
  Reflect.defineMetadata(RATE_LIMIT_KEY, rateLimit, handler);
  class TestController {}
  return {
    getHandler: () => handler,
    getClass: () => TestController,
    switchToHttp: () => ({ getRequest: () => request as Request, getResponse: () => ({}), getNext: () => undefined }),
  } as unknown as ExecutionContext;
}

maybeDescribe("RateLimitGuard against a real Redis-compatible server", () => {
  let RateLimitGuardCtor: typeof import("./rate-limit.guard").RateLimitGuard;
  let RateLimitExceededError: typeof import("./rate-limit.guard").RateLimitExceededError;
  let resetSharedClient: typeof import("./rate-limit.guard")._resetSharedRedisClientForTests;
  let cleanupClient: IORedis;
  const originalRedisUrl = process.env.REDIS_URL;

  beforeAll(async () => {
    process.env.REDIS_URL = TEST_REDIS_URL;
    // Imported dynamically, after REDIS_URL is set, so the module's own
    // lazy client cache picks up the real URL rather than a `null` any
    // earlier import in this same file might otherwise have cached.
    const mod = await import("./rate-limit.guard");
    RateLimitGuardCtor = mod.RateLimitGuard;
    RateLimitExceededError = mod.RateLimitExceededError;
    resetSharedClient = mod._resetSharedRedisClientForTests;
    cleanupClient = new IORedis(TEST_REDIS_URL!);
  });

  afterAll(async () => {
    process.env.REDIS_URL = originalRedisUrl;
    await resetSharedClient();
    await cleanupClient.quit();
  });

  test("two separate guard instances (standing in for two app processes) share the same rate limit via Redis", async () => {
    const clientIp = `redis-test-${randomUUID()}`;
    const handlerName = `sharedHandler-${randomUUID()}`;
    const options: RateLimitOptions = { max: 2, windowMs: 60_000 };

    // Two independent instances, each with its own private in-memory Map —
    // if this were still in-memory-only, guardB would have no idea guardA
    // ever saw a request from this client at all.
    const guardA = new RateLimitGuardCtor(new Reflector());
    const guardB = new RateLimitGuardCtor(new Reflector());

    await expect(guardA.canActivate(makeContext({ ip: clientIp }, options, handlerName))).resolves.toBe(true);
    await expect(guardB.canActivate(makeContext({ ip: clientIp }, options, handlerName))).resolves.toBe(true);
    // Third request, third guard instance, same client+handler — max is 2,
    // and both prior hits were recorded by DIFFERENT guard instances, so
    // this only fails if that state genuinely lives in Redis, not in
    // either guard's own private Map.
    const guardC = new RateLimitGuardCtor(new Reflector());
    await expect(guardC.canActivate(makeContext({ ip: clientIp }, options, handlerName))).rejects.toThrow(RateLimitExceededError);
  });

  test("a request outside the window is allowed again — real expiry, not simulated", async () => {
    const clientIp = `redis-test-${randomUUID()}`;
    const handlerName = `expiryHandler-${randomUUID()}`;
    const options: RateLimitOptions = { max: 1, windowMs: 500 };
    const guard = new RateLimitGuardCtor(new Reflector());

    await expect(guard.canActivate(makeContext({ ip: clientIp }, options, handlerName))).resolves.toBe(true);
    await expect(guard.canActivate(makeContext({ ip: clientIp }, options, handlerName))).rejects.toThrow(RateLimitExceededError);

    await new Promise((resolve) => setTimeout(resolve, 700));

    await expect(guard.canActivate(makeContext({ ip: clientIp }, options, handlerName))).resolves.toBe(true);
  }, 10000);

  test("tracks each client IP separately in Redis too", async () => {
    const handlerName = `perIpHandler-${randomUUID()}`;
    const options: RateLimitOptions = { max: 1, windowMs: 60_000 };
    const guard = new RateLimitGuardCtor(new Reflector());
    const ipA = `redis-test-${randomUUID()}`;
    const ipB = `redis-test-${randomUUID()}`;

    await expect(guard.canActivate(makeContext({ ip: ipA }, options, handlerName))).resolves.toBe(true);
    await expect(guard.canActivate(makeContext({ ip: ipA }, options, handlerName))).rejects.toThrow(RateLimitExceededError);
    // A different IP hitting the same handler is unaffected.
    await expect(guard.canActivate(makeContext({ ip: ipB }, options, handlerName))).resolves.toBe(true);
  });
});

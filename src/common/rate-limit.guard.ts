import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import IORedis from "ioredis";
import { RATE_LIMIT_KEY, RateLimitOptions } from "./rate-limit.decorator";

/**
 * Real gap found by deep review, not a live incident: with real money now
 * flowing through PayFast (merchant-of-record, Master Plan Addendum v1.4)
 * and MFA-protected owner accounts, nothing anywhere rate-limits a public
 * or auth-sensitive endpoint — `/auth/login` could be brute-forced,
 * `/payments/itn` and `/social/callback` (both deliberately unauthenticated
 * — see their own controllers' comments) could be hammered by anyone who
 * finds the URL. Fixed before any real tenant transacts, not after abuse.
 *
 * Hand-rolled, not a new dependency (`@nestjs/throttler`) — same
 * dependency-count discipline package.json's own notes already state for
 * JWT/TOTP/password hashing: a sliding-window counter is simple enough to
 * own outright, unlike a real job queue (bullmq), which had no reasonable
 * hand-rolled substitute.
 *
 * UPGRADED 2026-09-12, closing the real gap this file's own comment used
 * to disclose here: the in-process `Map` below is now the fallback, not
 * the only option. When `REDIS_URL` is set, this shares state across
 * however many app processes are actually running, using `ioredis`
 * (already a real dependency here, per package.json's own notes, for
 * BullMQ) — no new dependency for this. Same "config-gated, degrades
 * cleanly" pattern as `PG_POOL`/`NOTIFICATION_QUEUE`: zero configuration
 * still works exactly as before (the in-memory path, unchanged, is why
 * every existing test in rate-limit.guard.test.ts still passes with no
 * changes — none of them set `REDIS_URL`). `canActivate()`'s return type
 * is `boolean | Promise<boolean>` (both valid per Nest's own
 * `CanActivate` interface) specifically so the in-memory path can stay
 * fully synchronous rather than forcing every caller through a Promise
 * for a check that was never async to begin with.
 *
 * The Redis path uses a Lua script (`redis.eval`, atomic — no
 * check-then-act race between two concurrent requests) implementing the
 * exact same sliding-window semantics as the in-memory path below: a
 * sorted set keyed per class+handler+client, scored by request timestamp,
 * pruned of anything older than the window on every call, capped at
 * `max`. A transient Redis error (a dropped connection, a timeout) fails
 * OPEN — logs and allows the request through — rather than failing
 * closed and taking down a public endpoint over an infrastructure blip;
 * rate limiting is an abuse-prevention concern, not an authorization one,
 * and availability matters more here than a missed rate-limit check
 * during a real Redis outage.
 */
const SLIDING_WINDOW_SCRIPT = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local windowStart = tonumber(ARGV[2])
local max = tonumber(ARGV[3])
local windowSeconds = tonumber(ARGV[4])
local member = ARGV[5]

redis.call("ZREMRANGEBYSCORE", key, "-inf", windowStart)
local count = redis.call("ZCARD", key)
if count >= max then
  return 0
end
redis.call("ZADD", key, now, member)
redis.call("EXPIRE", key, windowSeconds)
return 1
`;

/**
 * REAL BUG found live-testing this against an actual Redis server, not
 * assumed: ioredis's own `defineCommand({ numberOfKeys: 1 })` already
 * fixes how many of the CALL's own arguments become Lua's `KEYS` — the
 * call site itself must NOT also pass a numKeys argument, or every
 * argument after it shifts one position to the right. An earlier version
 * of this interface/call site did exactly that (a stray `numKeys`
 * parameter here), which silently corrupted `max` into whatever
 * `windowStart`'s huge millisecond timestamp was — `count >= max` was
 * then never true, so the Redis path never rejected a single request,
 * caught only by rate-limit.guard.redis.test.ts's own real assertions
 * failing ("Resolved to value: true" where a throw was expected), not by
 * reading the code.
 */
interface RateLimitRedisClient extends IORedis {
  mytrimaSlidingWindow(key: string, now: number, windowStart: number, max: number, windowSeconds: number, member: string): Promise<number>;
}

/** Lazily created, shared across every RateLimitGuard instance in this
 * process (Nest creates one guard instance per controller that uses
 * `@UseGuards(RateLimitGuard)` without an explicit shared provider — this
 * module-level singleton is what keeps that from opening a separate Redis
 * connection per controller). `undefined` = not yet attempted; `null` =
 * attempted and REDIS_URL is unset, so every future call skips straight
 * to the in-memory path with no repeated env lookup. */
let sharedClient: RateLimitRedisClient | null | undefined;

function getSharedRedisClient(): RateLimitRedisClient | null {
  if (sharedClient !== undefined) return sharedClient;
  const url = process.env.REDIS_URL;
  if (!url) {
    sharedClient = null;
    return null;
  }
  const client = new IORedis(url, { maxRetriesPerRequest: 1, lazyConnect: false }) as RateLimitRedisClient;
  client.defineCommand("mytrimaSlidingWindow", { numberOfKeys: 1, lua: SLIDING_WINDOW_SCRIPT });
  client.on("error", () => {
    // Swallowed deliberately — a logged-but-unhandled 'error' event would
    // otherwise crash the process (Node's default behavior for an
    // EventEmitter's 'error' event with no listener). Real connection
    // failures still surface per-call, in canActivate()'s own try/catch.
  });
  sharedClient = client;
  return client;
}

/** Test-only: closes and forgets the shared client so a test file that
 * flips `REDIS_URL` on/off (rate-limit.guard.redis.test.ts) doesn't leak
 * an open Redis connection past its own `afterAll` — Jest's own "did not
 * exit one second after the test run completed" warning, found live-
 * running that test, not anticipated. Not used anywhere in real app
 * code, which never needs to un-cache this. */
export async function _resetSharedRedisClientForTests(): Promise<void> {
  await sharedClient?.quit();
  sharedClient = undefined;
}

@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  private readonly hitsByKey = new Map<string, number[]>();

  canActivate(context: ExecutionContext): boolean | Promise<boolean> {
    const options = this.reflector.get<RateLimitOptions | undefined>(RATE_LIMIT_KEY, context.getHandler());
    if (!options) return true; // no @RateLimit() on this handler — not limited

    const request = context.switchToHttp().getRequest<Request>();
    const clientKey = request.ip ?? request.socket.remoteAddress ?? "unknown";
    const key = `ratelimit:${context.getClass().name}.${context.getHandler().name}:${clientKey}`;

    const redis = getSharedRedisClient();
    if (redis) return this.checkRedis(redis, key, options);
    return this.checkInMemory(key, options);
  }

  private checkInMemory(key: string, options: RateLimitOptions): boolean {
    const now = Date.now();
    const windowStart = now - options.windowMs;
    const recentHits = (this.hitsByKey.get(key) ?? []).filter((t) => t > windowStart);

    if (recentHits.length >= options.max) {
      throw new RateLimitExceededError(options.max, options.windowMs);
    }

    recentHits.push(now);
    this.hitsByKey.set(key, recentHits);
    return true;
  }

  private async checkRedis(redis: RateLimitRedisClient, key: string, options: RateLimitOptions): Promise<boolean> {
    const now = Date.now();
    const windowStart = now - options.windowMs;
    const windowSeconds = Math.max(1, Math.ceil(options.windowMs / 1000));
    // A random suffix, not just `now`, as the sorted-set member — two
    // requests landing in the same millisecond would otherwise collide on
    // the same ZADD member and only count once.
    const member = `${now}-${Math.random().toString(36).slice(2)}`;

    try {
      const allowed = await redis.mytrimaSlidingWindow(key, now, windowStart, options.max, windowSeconds, member);
      if (allowed !== 1) {
        throw new RateLimitExceededError(options.max, options.windowMs);
      }
      return true;
    } catch (err) {
      if (err instanceof RateLimitExceededError) throw err;
      // A real Redis/network failure, not a rate-limit rejection — see
      // this file's own top comment on why this fails open rather than
      // closed.
      // eslint-disable-next-line no-console
      console.error(`[RateLimitGuard] Redis check failed for "${key}", allowing the request through:`, err);
      return true;
    }
  }
}

export class RateLimitExceededError extends Error {
  constructor(max: number, windowMs: number) {
    super(`Too many requests — limit is ${max} per ${Math.round(windowMs / 1000)}s. Try again shortly.`);
    this.name = "RateLimitExceededError";
  }
}

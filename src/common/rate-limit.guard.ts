import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
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
 * KNOWN GAP, disclosed rather than hidden: this state is a single
 * in-process Map, not shared across multiple app instances. Fine for this
 * pilot's single-process deployment (Master Plan Section 2's own
 * "right-size before scale" principle, same reasoning as the in-process
 * BullMQ worker); revisit with a real shared store (Redis, already a real
 * dependency here) if this ever runs behind more than one process.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  private readonly hitsByKey = new Map<string, number[]>();

  canActivate(context: ExecutionContext): boolean {
    const options = this.reflector.get<RateLimitOptions | undefined>(RATE_LIMIT_KEY, context.getHandler());
    if (!options) return true; // no @RateLimit() on this handler — not limited

    const request = context.switchToHttp().getRequest<Request>();
    const clientKey = request.ip ?? request.socket.remoteAddress ?? "unknown";
    const key = `${context.getClass().name}.${context.getHandler().name}:${clientKey}`;

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
}

export class RateLimitExceededError extends Error {
  constructor(max: number, windowMs: number) {
    super(`Too many requests — limit is ${max} per ${Math.round(windowMs / 1000)}s. Try again shortly.`);
    this.name = "RateLimitExceededError";
  }
}

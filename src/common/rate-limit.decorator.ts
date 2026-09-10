import { SetMetadata } from "@nestjs/common";

export const RATE_LIMIT_KEY = "rateLimit";

export interface RateLimitOptions {
  /** Max requests allowed from one client within `windowMs`. */
  max: number;
  windowMs: number;
}

/** Applies RateLimitGuard's own per-route, per-client sliding-window limit
 * to a single handler. A route with no @RateLimit() at all is unaffected
 * (RateLimitGuard treats the absence of this metadata as "not limited"),
 * so this is opt-in per endpoint, not a global default. */
export const RateLimit = (options: RateLimitOptions) => SetMetadata(RATE_LIMIT_KEY, options);

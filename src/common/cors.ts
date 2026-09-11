/**
 * Parses `CORS_ORIGIN` into the list `app.enableCors()` (main.ts) needs —
 * a real fix for the gap the Platform Readiness Assessment flagged: this
 * app called no `enableCors()` at all, so a frontend hosted on its own
 * origin would have every request silently blocked by the browser itself.
 * Deliberately config-gated, fails closed if unset — same pattern as
 * ADMIN_API_KEY/TENANT_SIGNUP_CODE: cross-origin access stays off until a
 * real frontend origin is known and set, not opened to any origin as a
 * guessed default. Kept in its own file (not inline in main.ts) so it's a
 * plain, importable, unit-testable function — main.ts's own bootstrap()
 * runs unconditionally at import time, which a test file must never
 * trigger.
 */
export function corsOrigins(): string[] | undefined {
  const raw = process.env.CORS_ORIGIN;
  if (!raw) return undefined;
  const origins = raw
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
  return origins.length > 0 ? origins : undefined;
}

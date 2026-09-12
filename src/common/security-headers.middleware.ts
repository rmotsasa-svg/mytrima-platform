import type { Request, Response, NextFunction } from "express";

/**
 * Real gap found by the 2026-09-12 landing-page security assessment: this
 * app set NO HTTP security headers anywhere, on any response — confirmed
 * live, not assumed, by curl-ing a running instance and seeing a bare
 * `X-Powered-By: Express` and nothing else. That header alone is a small,
 * real fingerprinting leak (advertises the exact framework to anyone
 * probing this API); the missing headers below are a real, if modest,
 * defense-in-depth gap for the one genuinely HTML-serving route this app
 * has (AppController's dashboard) and for every JSON response besides.
 *
 * Hand-rolled, not a new dependency (`helmet`) — same dependency-count
 * discipline package.json's own notes already state for JWT/TOTP/
 * password/rate-limiting: a handful of static header assignments is
 * simple enough to own outright, unlike a real job queue (bullmq) or SMTP
 * client (nodemailer), which had no reasonable hand-rolled substitute.
 * This deliberately does NOT attempt a Content-Security-Policy here —
 * see landing/index.html's own CSP (and its "frame-ancestors is ignored
 * in a <meta> tag" finding) for why a real one needs per-route knowledge
 * of exactly what that route serves; a single blanket CSP across every
 * JSON endpoint plus the one HTML dashboard route would either break the
 * dashboard or be too loose to mean anything.
 */
export function securityHeaders(_req: Request, res: Response, next: NextFunction): void {
  // Real info-disclosure fix, not just hardening: without this, Express
  // sets `X-Powered-By: Express` on every response by default.
  res.removeHeader("X-Powered-By");

  res.setHeader("X-Content-Type-Options", "nosniff");
  // Legacy but still widely honored, and — unlike CSP's frame-ancestors —
  // actually works when set as a real HTTP header (not a <meta> tag,
  // which is this app's own concern anyway; this header protects the
  // dashboard route directly).
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  // Harmless to send over plain HTTP — browsers ignore Strict-Transport-
  // Security on a non-HTTPS response per spec, so this has no effect in
  // local dev and takes effect automatically the moment this runs behind
  // real TLS.
  res.setHeader("Strict-Transport-Security", "max-age=63072000; includeSubDomains");
  res.setHeader("X-Permitted-Cross-Domain-Policies", "none");
  // Denies browser features this API never needs from any origin,
  // including its own — there is no camera/microphone/geolocation use
  // anywhere in this app.
  res.setHeader("Permissions-Policy", "geolocation=(), camera=(), microphone=()");

  next();
}

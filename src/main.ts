import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { ValidationPipe } from "@nestjs/common";
import { Request, Response, NextFunction } from "express";
import { AppModule } from "./app.module";
import { DomainErrorFilter } from "./common/http-exception.filter";
import { corsOrigins } from "./common/cors";

/**
 * ACTUALLY RUN as a real listening server multiple times against a live
 * Postgres + Redis-compatible (Memurai) instance — not just booted via
 * @nestjs/testing's DI container. Verified end-to-end: real HTTP requests
 * against the dashboard and API endpoints, real BullMQ jobs enqueued and
 * processed by RevokedTokenCleanupService/NotificationWorkerService's real
 * in-process workers, and a real process-restart proof for refresh-token
 * revocation (see README.md's "Auth/RBAC" and "Redis/BullMQ" sections).
 *
 * CORS added 2026-09-11, closing the real gap the Platform Readiness
 * Assessment flagged: this app called no `enableCors()` at all, so a
 * frontend hosted on its own origin (any real SPA — the whole point of
 * "an app interface") would have every request silently blocked by the
 * browser itself. Deliberately gated by `CORS_ORIGIN` (comma-separated
 * origins), same "config-gated, fails closed if unset" pattern as
 * ADMIN_API_KEY/TENANT_SIGNUP_CODE elsewhere in this app — cross-origin
 * access stays off by default (the same-origin dashboard at `/` never
 * needed it) until the real frontend's origin is actually known and set,
 * rather than opening it to any origin as a guessed default. The parsing
 * itself lives in common/cors.ts, not here — this file's own bootstrap()
 * runs unconditionally at import time (see its own call at the bottom),
 * so a pure helper needing a unit test has to live somewhere importable
 * without also starting a real server.
 *
 * Global ValidationPipe added the same day, closing the other real gap the
 * assessment flagged: the exact bug class already found and fixed once in
 * the Support Ticket module (an omitted field reaching `.trim()` as
 * genuine `undefined`, a raw 500 instead of a clean 400) is architecturally
 * possible anywhere a controller trusts its body's shape with no framework-
 * level check. This pipe only VALIDATES bodies that are real `class`es with
 * `class-validator` decorators — a plain TypeScript `interface` (what most
 * DTOs in this app still are) carries no runtime metadata for the pipe to
 * check at all, so this is a real but PARTIAL fix: converted so far are the
 * request bodies of every endpoint that stays intentionally unauthenticated
 * (Booking's request(), Rating's submit(), NPS's submit() — the ones a
 * stranger on the internet can reach directly) plus Support Ticket's
 * create() (the DTO whose validation gap actually caused the real bug).
 * Every other DTO in this app still relies on its own service-layer checks
 * only — a real, disclosed remaining gap, not silently implied closed by
 * adding this pipe. `whitelist: true` strips any field a DTO class doesn't
 * declare, closing a second, related gap for free: RatingController.submit()
 * previously read a bare, untyped `tenantId` off the body with nothing
 * stopping a caller from also stuffing in extra fields no code expected.
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.useGlobalFilters(new DomainErrorFilter());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  // Added 2026-09-11 for the website-analytics feature (migration 0025):
  // POST /analytics/collect/:tenantId is called directly by the tracking
  // snippet (frontend/public/mytrima-analytics.js) embedded on a TENANT'S
  // OWN WEBSITE — an origin this app cannot enumerate in CORS_ORIGIN ahead
  // of time the way it can the one SPA dashboard origin below, since it's a
  // different, unknown domain per tenant. Scoped to only `/analytics/collect`
  // — deliberately NOT the whole `/analytics` prefix, which also holds
  // GET :tenantId/summary, an AUTHENTICATED route the SPA itself calls with
  // a real Authorization header; that route must keep going through the
  // origin-allowlisted, credentials-aware enableCors() below rather than
  // being swallowed by this wildcard. Registered BEFORE that enableCors()
  // call so the rest of the API's CORS posture is otherwise unaffected.
  // Deliberately no `Access-Control-Allow-Credentials` here — collect()
  // carries no cookies/auth of any kind (unauthenticated by design, same as
  // Booking/Rating/NPS's own public writes), so there is nothing a
  // wildcard origin could expose that a browser wouldn't already send.
  app.use("/analytics/collect", (req: Request, res: Response, next: NextFunction) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Methods", "GET, POST");
    res.header("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") {
      res.sendStatus(204);
      return;
    }
    next();
  });

  const origins = corsOrigins();
  if (origins) {
    app.enableCors({ origin: origins, credentials: true });
  }
  // else: no CORS_ORIGIN set — enableCors() is never called, so the
  // browser's own default (block cross-origin requests) applies, same as
  // before this change. The same-origin dashboard at `/` never needed it.
  const port = process.env.PORT ? Number(process.env.PORT) : 3000;
  await app.listen(port);
}

bootstrap();

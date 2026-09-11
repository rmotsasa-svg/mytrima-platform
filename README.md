# Mytrima Platform — NestJS Application Shell

**Repository**: [github.com/rmotsasa-svg/mytrima-platform](https://github.com/rmotsasa-svg/mytrima-platform) —
genuinely version-controlled and CI-tested for the first time as of this pass (see
"RLS: proven live" below for the actual first CI run).

This is a **partial, honest scaffold**, not a working product. It implements the pieces
of the Technical Master Plan that don't depend on an unresolved vendor or legal
confirmation, and it clearly stubs everything that does. Read this file before assuming
any module is further along than it is.

**Synced to Master Plan v1.2** (25 August 2026). Two scope changes since this scaffold
was first built against v1.0, both reflected below: Hellopeter was removed and replaced
by an in-house Rating Module, and LinkedIn was removed from scope entirely.

**Migrated to a real NestJS app** (see "On the tech stack" below) once actual npm
registry access was confirmed available — this is no longer the dependency-free
tsx/node:test scaffold it started as. Every business-logic module below carried over
unchanged; what's new is the NestJS controllers/modules/DI wiring around them, and Jest
replacing node:test.

## What was actually built and verified

Verified means: written, compiled, and run in this environment, with real assertions
that pass — not just written and assumed correct.

| Module | What it does | Verification |
|---|---|---|
| `db/migrations/0001`–`0006` | Tenant, customer, consent, growth-audit, rating, NPS response, and refresh-token-revocation tables; MFA secret + password_hash columns; RLS policies (with `WITH CHECK`) for tenant isolation | **Actually run against a real local PostgreSQL 17 instance — all 6 migrations apply cleanly, and the RLS negative test genuinely passes.** Caught and fixed real bugs in the process (see "RLS: proven live" and "Real Postgres-backed stores" below) — this is no longer "written but unexecuted." A stale doc bug was also caught and fixed here: migrations 0002/0003/0004 still claimed "NOT YET RUN AGAINST A REAL DATABASE" despite having been run and live-verified extensively earlier in this same session — corrected to reflect what had actually already been proven. |
| `infra/terraform/*.tf` | RDS PostgreSQL + ElastiCache Redis for `af-south-1`, per the hosting decision and Master Plan Section 4 ("Terraform from day one") | **`terraform validate` actually run and passes** (real AWS provider v5.100.0, downloaded and checked against — not memory). **Not `plan`'d or `apply`'d** — that needs real AWS credentials this assistant doesn't have. See `infra/terraform/README.md`. |
| `growth-audit.service.ts` + `questions.data.ts` | Scores the 40-point Growth Audit exactly per the questionnaire's Scoring Worksheet formula, and now persists every submission | **14/14 tests pass**: the 11 original scoring-engine tests (hand-calculated example, all four Performance Scale Index band boundaries, input-validation edge cases) plus 3 new ones proving `GrowthAuditService` persists a submission, rejects an invalid one before ever touching the store, and scopes history per tenant. |
| `growth-audit/pg-growth-audit-response.store.ts` | Real Postgres-backed `GrowthAuditResponseStore`, against `growth_audit_response` (existed with RLS since migration 0001; no store had ever read or written it) | **3/3 tests genuinely pass against the real database**, including a full jsonb round-trip of the answers and section scores. |
| `nps.service.ts` | In-house NPS scoring (categorization + the standard %promoter − %detractor formula), and now persists every response | **11/11 tests pass**: the 7 original pure-function tests (hand-calculated mixed example included) plus 4 new ones proving `NpsService` persists a response, rejects an invalid score before ever touching the store, and scopes the aggregate per tenant. |
| `growth-audit/pg-nps-response.store.ts` | Real Postgres-backed `NpsResponseStore`, against a new `nps_response` table (migration 0006) | **4/4 tests genuinely pass against the real database**, including a hand-calculated NPS from real rows and that submitting against a non-existent customer fails the real foreign-key constraint. |
| `consent.service.ts` | Tenant-scoped consent grant/revoke/DSAR export, per POPIA accountability requirements | **6/6 tests pass** against an in-memory store, including a test that another tenant's consent grant does not satisfy a different tenant's check, and (added building the real Postgres store) that revoking with the wrong tenantId has no effect. |
| `reputation/rating.service.ts` | In-house star rating + moderation (pending → public/hidden) + tenant-scoped aggregate, replacing Hellopeter; `moderate()` now returns the updated rating so a `notificationsForModeratedRating` event can actually fire | **13/13 tests pass**, including tenant scoping, a hand-calculated aggregate, that moderating with the wrong tenantId has no effect, and (new) that `moderate()` returns the updated rating / `null` for a wrong-tenant or unknown id. |
| `auth/password.ts` | Password hashing (scrypt, built into Node — no bcrypt/argon2 dependency) | **4/4 tests pass**, including that the same password hashed twice yields different (but both-valid) stored values. |
| `auth/jwt.ts` | Hand-rolled HMAC-SHA256 JWT sign/verify (no `jsonwebtoken` dependency) | **6/6 tests pass**, including tamper detection, wrong-secret rejection, and expiry. |
| `auth/totp.ts` | TOTP MFA (RFC 6238), hand-rolled on Node's `crypto` | **13/13 tests pass**, including all 6 of RFC 6238 Appendix B's official published test vectors matched exactly — not just internally self-consistent. |
| `auth/rbac.ts` | Tenant-scoped role-based access control (Owner/Staff/Read-only) | **7/7 tests pass**, including that a cross-tenant access attempt is rejected for every role, owner included. |
| `auth/auth.service.ts` | Registration, login (with Owner MFA enforcement), MFA enrollment (start/confirm), refresh-token rotation + revocation, logout, access-token verification | **20/20 tests pass**, live-verified too (see below) — including that access and refresh tokens are rejected if swapped, a used-once refresh token can't be replayed, and (added building the real Postgres store) MFA enrollment with the wrong tenantId is rejected. |
| `auth/mfa-secret-crypto.ts` | AES-256-GCM encryption for the MFA secret at rest (closes a previously-flagged known gap) | **6/6 tests pass**, including that a tampered ciphertext fails the auth-tag check rather than decrypting into garbage, and that the wrong key fails cleanly. |
| `auth/access-token.guard.ts` | Closes the MFA-enrollment auth-guard gap — derives the caller's identity from their own verified access token, never from request-body input | **5/5 tests pass**, including that a refresh token is rejected even though it's validly signed by the same issuer, plus a full cross-account end-to-end regression test in `app.module.test.ts` through the real DI-wired guard + controller + service + store. |
| `automation/automation.service.ts` | Notification triggers from Growth Audit bands, NPS detractors, and moderated ratings | **8/8 tests pass**, including that Stable/High-Growth results and public ratings correctly trigger nothing. |
| `automation/notification-delivery.service.ts` + `notification-worker.service.ts` | Real BullMQ queue producer + in-process worker — Master Plan Section 4's Redis/BullMQ requirement, previously entirely unbuilt | **Full suite passes, live-verified end-to-end including a real WhatsApp send** — a real NPS detractor response enqueued a real job, picked up by a real worker against real Redis, which resolved the tenant's real notification phone and sent a real WhatsApp message via `WhatsAppCloudApiService`, independently confirmed received. See "WhatsApp: from 'Assumed' to a real, live-verified send" below. |
| `integrations/whatsapp/whatsapp.service.ts` | Real client for the WhatsApp Cloud API (send a template or freeform message) | **7/7 tests pass against a mocked `fetch`, plus live-verified against the real Cloud API** — a real message delivered to a real phone, confirmed received. See below. |
| `integrations/payments/payfast.service.ts` | Real client for PayFast's Custom Integration + Split Payments flow (merchant-of-record payments) | **17/17 tests pass against a hand-verified MD5 signature reference and mocked `fetch`, plus live-verified against PayFast's real public sandbox** — a real signed request was accepted by PayFast's own hosted checkout page and rendered our exact item/amount; the real ITN server-confirmation endpoint was confirmed live. See "PayFast" below. |
| `payments/*` (`payments.controller.ts`, `payfast-itn-log.service.ts`) | Real checkout + ITN-receiving endpoints, backed by each Tenant's own stored PayFast merchant id | **Full suite passes, live-verified idempotency**: real ITN signature verification (now using the real arrival-order algorithm, a real bug fixed — see below), tenant-scoped audit logging (`payfast_itn_log`, migrations 0015/0016), idempotent on `(tenant_id, pf_payment_id)`, and DI-resolved through the real Nest container end to end. |
| `growth-audit/recommendation.service.ts` | The Growth Audit recommendation engine — closes the diagnose-but-never-prescribe gap. See "Deep-analysis recommendations" below. | **Full suite passes, live-verified end to end**: a real weak audit answer produced a real recommendation; acting on it for real (a real KPI benchmark) made it disappear and flip a real `actionToActionRate` from 0 to 50. |
| `onboarding/onboarding.service.ts` | Computed tenant setup-completeness checklist (5 real signals, no stored flag) | **Full suite passes, live-verified**: a fresh tenant reads 0% complete; every real signal added live tracked correctly. |
| `admin/pilot-summary.service.ts` | Real cross-tenant operator reporting, gated by a shared `ADMIN_API_KEY` | **Full suite passes, live-verified**: rejected without/with the wrong key (403), real summary returned with the correct one. |
| `common/rate-limit.guard.ts` | Hand-rolled per-route rate limiting, applied to `/auth/login`, `/payments/itn`, `/social/callback` | **Full suite passes, live-verified**: 11 real requests to `/auth/login` — the first 10 real 401s, the 11th a real 429. |
| `reports/snapshot.service.ts` | The consolidated Business Snapshot report — Executive Summary, period-over-period Performance (now including total units sold), Findings, Action Plan, Methodology, and real Meta social metrics. See "The Business Snapshot report" below. | **Full suite passes, live-verified end to end**: real sales in two real periods produced a real +100% delta, correct churn/repeat-rate detection, and the real recommendation-engine action for a deliberately weak audit answer. |
| `sales/sale.service.ts` (`computeRepeatRate`) | New-customer repeat rate — a real, distinct KPI from Churn Rate, sourced from a real reference report | **Tests pass, live-verified** as part of the Snapshot report above. |
| `social-publishing/social-metrics.service.ts` | Real Meta account metrics (likes, comments, shares, followers, impressions, views, message threads) for the Business Snapshot | **Full suite passes**; live-verified for the "not connected" state — see the Meta metrics section below for the real Graph API permission gap still pending. |
| `common/period.ts` | Shared period-comparison helpers (`previousPeriod`, `computeDelta`) | **Tests pass** — every null case (no previous value, previous is zero) is a real "can't be computed," not a guessed number. |
| `booking/booking.service.ts` | A tenant's customers booking a `service` catalog item for a specific time — real slot-overlap detection, full status lifecycle. See "Booking module" below. | **Full suite passes, live-verified end to end**: a real conflict was rejected with a real 409 naming the clashing booking, an invalid status transition was rejected, and a cancelled booking's slot was proven to genuinely free up for re-booking. |
| `support/support-ticket.service.ts` + `admin/support-ticket-admin.service.ts` | A tenant's own way to report a problem with Mytrima itself, plus the operator's cross-tenant queue to work through them. See "Support ticket module" below. | **Full suite passes, live-verified end to end**: a real ticket filed by one tenant appeared in the operator's cross-tenant view alongside another tenant's, moved through in_progress → resolved with a real resolution note, and was reopened — a resolve attempt with no resolution note was correctly rejected. |
| `auth/staff.controller.ts` (+ new `AuthService` methods) | The Staff module — list/view staff, change role, deactivate/reactivate, self-service profile + password change. See "Staff module" below. | **Full suite passes, live-verified end to end**: a real invited staff member was listed, role-changed, deactivated (login correctly rejected), and reactivated (login correctly succeeded again); the tenant's last active owner could not be deactivated or demoted. |
| `src/app.module.ts` + every `*.module.ts` | The NestJS application shell itself: DI wiring, controllers, module boundaries | **2/2 tests pass** (`app.module.test.ts`) — boots the real Nest DI container via `@nestjs/testing`, resolves every controller/service from it, and logs in as the seeded demo account through it. These are the tests that would catch a missing provider, an unbound `@Inject()` token, or a broken seed factory; every other test exercises a service directly and says nothing about whether the app actually wires together. |
| `src/common/http-exception.filter.ts` | Maps domain errors to HTTP status codes; passes Nest's own `HttpException`s through untouched | **3/3 tests pass**, including a regression test for a real bug caught by hand-testing (see below) |
| `integrations/payments/mopay.service.ts` | Real client for MoPay's public, documented payment API (create session, redirect, verify) | **6/6 tests pass against a mocked `fetch`** (deterministic, network-free CI), **plus a real sandbox API key was used once to actually create and retrieve a session against the live API** — confirming auth, request shape, and response parsing all genuinely work. See "MoPay: a real integration, not a guess" below. |
| `integrations/reputation/google-business.service.ts` | Real client for the Business Profile Reviews API (fetch a location's reviews) | **5/5 tests pass against a mocked `fetch`** — request shaping and the documented `ONE`–`FIVE` star-rating enum normalization are verified. **NOT run against a live call** — this API has no API-key path at all; it needs a completed per-tenant OAuth consent flow first. See "Google Business Profile: access approved, but this needs a per-tenant OAuth flow" below. |
| `integrations/social/meta.service.ts` | Real client for the Meta Graph API (publish a Page post, fetch its reactions/comments/shares) | **6/6 tests pass against a mocked `fetch`**, **plus live-verified against the real Graph API** — publish, engagement read, and delete all confirmed against a real Facebook Page. See "Facebook & Instagram: a real Meta Graph API client" below. |
| `social-publishing/*` (`meta-oauth.service.ts`, `social-connection.service.ts`, `social-publishing.controller.ts`) | Real Facebook Login OAuth (built for Meta App Review's "on your app platform" requirement) + dashboard-driven post create/edit/delete for both Facebook and Instagram, backed by a saved per-tenant connection instead of a manually pasted token | **Full test suite passes; the Facebook side is live-verified end-to-end**: real OAuth redirect → real consent click → real code exchange → real Page resolved and saved to Postgres → create/edit/delete a real post entirely through the saved connection. **The Instagram side is built and unit-tested but not yet live-verified** — no Instagram account linked to the test Page yet. See "Facebook & Instagram" below for the full trace and the honest gap. |
| `common/postgres.ts` | Transaction-scoped `app.current_tenant_id` helper every Pg\*Store below uses — the exact "connection pooling + RLS" interaction the project flagged as unverified since its first migration | **3/3 tests genuinely pass against a real local PostgreSQL 17 instance** (gated behind `TEST_DATABASE_URL` — skip gracefully without it), including that two tenants sharing a *single* pooled connection (`max: 1`, deliberately forcing reuse) never see each other's rows, and that a failed query rolls back rather than leaving partial state. |
| `compliance/pg-consent.store.ts` | Real Postgres-backed `ConsentStore` | **4/4 tests genuinely pass against the real database**, run through `ConsentService` end-to-end. |
| `reputation/pg-rating.store.ts` | Real Postgres-backed `RatingStore` | **4/4 tests genuinely pass against the real database**, run through `RatingService` end-to-end. |
| `auth/pg-auth-user.store.ts` | Real Postgres-backed `AuthUserStore` | **4/4 tests genuinely pass against the real database**, including the full register → MFA enroll → confirm → login flow run through `AuthService` end-to-end against a real Postgres instance. |
| `auth/pg-revoked-token.store.ts` | Real Postgres-backed `RevokedRefreshTokenStore` — the last of the four stores to move off in-memory | **5/5 tests genuinely pass against the real database**, including a full login → refresh → refresh-again-rejected cycle through `AuthService`, and confirmed live (see "Auth/RBAC" below) to survive an actual process restart — the revoked token stays rejected, not just within one process's lifetime. |
| `customers/customer.service.ts` | A real minimal CRM: create, get one, edit, search, tenant-scoped list, and a "customer activity" view aggregating that customer's ratings + consent records | **21/21 tests pass**, including that at least one identifying field is required, whitespace-only fields trim to absent, tenant scoping throughout, that `update()` is a true partial update (a field left out of the call keeps its existing value — see below), and that `getActivity()` correctly excludes another customer's ratings. |
| `customers/pg-customer.store.ts` | Real Postgres-backed `CustomerStore`, against the `customer` table that has existed with RLS since migration 0001 | **8/8 tests genuinely pass against the real database**, including one that inserts a `rating` row against a customer created through this store (proving it satisfies `rating.customer_id`'s foreign key), and one proving a real `PATCH` leaves an unspecified column untouched rather than nulling it. |
| `catalog/catalog-item.service.ts` + `pg-catalog-item.store.ts` | Master Plan Addendum v1.3: a tenant's own product/service catalog — the prerequisite Deals and Sales are built on | **6/6 in-memory + 2/2 real-database tests pass**, including a real `PATCH` leaving an unspecified field untouched, same discipline as the Customer module. |
| `deals/deal.service.ts` + `pg-deal.store.ts` | Addendum §F: promotions (`percentage_off`, `buy_x_get_y_free`, `fixed_amount_off`) applicable to one or more catalog items | **9/9 in-memory + 2/2 real-database tests pass**, including hand-calculated "buy 2 get 1 free" / "buy 1 get 1 free" discount math and that a catalog item from a different tenant is rejected, enforced by RLS in the real-database test. |
| `petty-cash/vendor.service.ts` + `petty-cash.service.ts` (+ both Pg stores) | Addendum §G: a tenant's supplier list, and a real cash-out ledger (replenishments vs. vendor payments) with a computed-not-stored running balance | **8/8 in-memory + 4/4 real-database tests pass**, including that paying a vendor from a different tenant is rejected. |
| `sales/sale.service.ts` + `pg-sale.store.ts` | Addendum §E: the Sales & POS module — manual sale entry, deal application, all six originally-requested KPIs, plus Churn Rate and Customer Lifetime Value (added 2026-09-10, sourced from a real reference doc — see "Growth-strategy KPIs" below) | **Full suite passes**, including a real conversion-rate cross-module join against real Rating/NPS data (see "Sales, Deals & Petty Cash" below for the real bugs this caught) and hand-calculable Churn Rate / LTV examples. |
| `sales/sales-target.service.ts` + `pg-sales-target.store.ts` | Addendum §E: tenant- or per-staff sales goals for a period | **5/5 in-memory + 2/2 real-database tests pass**. |
| `sales/kpi-benchmark.service.ts` + `kpi-benchmark-check.service.ts` (+ Pg store) | Addendum §E: the fourth Automation & Notification Engine trigger — a real daily BullMQ job comparing live KPIs against tenant-set thresholds | **6/6 + 2/2 in-memory/no-pool tests pass, plus 2/2 real-database/Redis tests**, live-verified against the running server (see below). |
| `auth/tenant.service.ts` + `pg-tenant.store.ts` | Addendum §H: tenant self-service onboarding, gated by a shared signup code, failing closed when unset | **6/6 in-memory + 1/1 real-database tests pass**, including the full create-tenant → MFA-enroll → confirm → login flow end-to-end. |
| `auth/revoked-token-cleanup.service.ts` | Real daily BullMQ scheduled job deleting expired `revoked_refresh_token` rows — closes migration 0004's own long-flagged gap | **4/4 tests pass**, including a real-Postgres deletion-selectivity test and a real Postgres+Redis test proving the actual scheduled worker (not just the SQL) genuinely deletes a real row — plus live-verified against the real running server, restart included (see "Revoked-refresh-token cleanup" below). Building it surfaced a systemic Postgres/RLS connection-pooling bug affecting 9 files across the whole test suite — see that same section. |

**262/262 tests pass with neither Postgres nor Redis available** (324 defined in total —
the remaining 62 need one or both and skip gracefully without them, see "Real
Postgres-backed stores" below). Run `npm test` to reproduce this yourself — don't take the
count on faith. **324/324 with both available is the expected, not freshly re-confirmed,
total as of 2026-09-10** — the local `TEST_DATABASE_URL`/`TEST_REDIS_URL` credentials
weren't available in the session that added the Instagram/WhatsApp/MFA-fix work below, so
those 62 gated tests (all following the same already-proven patterns as the ones that ARE
confirmed above) haven't been freshly re-run against live infrastructure since. Re-run
both flags below to confirm the true total on a machine that has them. (One caveat worth
naming: under heavy parallel test load, a couple of the slowest multi-step real-database
tests can occasionally exceed Jest's default 5-second timeout — genuine timing tightness
under contention, not a logic bug; use `--maxWorkers=4` for exactly this reason.)

### The dashboard — and two real bugs it caught

`GET /` serves a single dependency-free HTML+JS page (`src/app.controller.ts`) for
clicking through the API instead of curl-only — not a designed product UI (Master Plan
Section 1 excludes that). It renders the real 40-question Growth Audit from
`GET /growth-audit/questions` rather than hardcoding a copy, and every action on it is a
same-origin `fetch()` against the actual controllers.

Building and manually clicking through it — not just running the existing test suite —
caught two real bugs that no unit test had exercised:

1. **A stale `node` process squatting on port 3000** from earlier in this session
   silently absorbed requests meant for the rebuilt server, so the new dashboard
   appeared to 404 even though the code was correct. Caught by running `node dist/main.js`
   directly in the foreground and seeing `EADDRINUSE`, not by trusting the preview
   tool's "server already running" status.
2. **`DomainErrorFilter` was forcing Nest's own `HttpException`s (e.g. its built-in 404
   for an unmatched route) through the domain-error map**, turning a plain 404 into a
   500 with `"error":"NotFoundException"`. Fixed by checking `instanceof HttpException`
   first and passing those through with their real status — domain errors are the only
   thing this filter should be inventing a status for. Now has a dedicated regression
   test (`http-exception.filter.test.ts`) so it can't silently regress.

Neither bug would have been caught by `npm test` alone — both needed the app actually
running and actually clicked through, which is the point of building this dashboard in
the first place.

**A "Customers" card was added** once `CustomerModule` existed (see "Wired into the
running app" below), and the Ratings card's free-text `customerId` field — the exact
input that produced the original foreign-key failure — was replaced with a `<select>`
populated from `GET /customers/:tenantId`, so the dashboard itself can no longer submit a
rating against a customer that doesn't exist. **Actually clicked through in a real
browser, not just curled**: created a customer via the "Create Customer" button, watched
it appear in both the customer list and the Ratings dropdown without a page reload, then
submitted a rating against it and got back a real `"status":"pending"` — no 500, no typed
customerId, no manual database row.

### The NestJS application shell

`src/main.ts` boots a real Nest app (`NestFactory.create(AppModule)`) with a global
`DomainErrorFilter` (`src/common/http-exception.filter.ts`) that maps this platform's
domain errors (`InvalidAuditAnswersError`, `InvalidCredentialsError`, etc.) to sensible
HTTP status codes by error name, so controllers don't need a try/catch in every method.
Five modules are wired into `AppModule`, one per tested business-logic area:

| Module | Controller(s) | Notable known gap |
|---|---|---|
| — | `GET /` — the dashboard (see below) | Dev/demo only, not a designed UI |
| `GrowthAuditModule` | `GET /growth-audit/questions`, `POST /growth-audit`, `GET /growth-audit/:tenantId` | Submissions now persist (DATABASE_URL-gated, same pattern as Consent/Rating/Auth/Customer); no auth guard yet, so `administered_by` is never recorded |
| `NpsModule` | `POST /nps`, `GET /nps/:tenantId/aggregate` | Responses now persist (DATABASE_URL-gated, same pattern as every other module); submitting requires a real `customer` row, same FK constraint as ratings |
| `ConsentModule` | `POST /consent/grant`, `POST /consent/:id/revoke`, `GET /consent/:tenantId/:customerId/export` | Backed by `InMemoryConsentStore` when `DATABASE_URL` is unset, real Postgres-backed `PgConsentStore` (and genuinely restart-persistent) when it is set — see "Wired into the running app" below |
| `RatingModule` | `POST /ratings`, `POST /ratings/:id/moderate`, `GET /ratings/:tenantId/aggregate` | Same DATABASE_URL-gated persistence; `moderate` fires a real `notificationsForModeratedRating` event (`RatingStore.findById` closed that gap — see "Rating moderation now fires a real notification" below); submitting a rating requires a `customer` row to already exist — `CustomerModule` below provides one |
| `AuthModule` | `POST /auth/tenants`, `POST /auth/verify-email`, `POST /auth/verify-email/resend`, `POST /auth/register`, `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout`, `POST /auth/mfa/enroll/start`, `POST /auth/mfa/enroll/confirm` | Same DATABASE_URL-gated persistence; registration requires an authenticated `owner` caller (see "Auth/RBAC" below) — a brand-new tenant's first account self-serves through `POST /auth/tenants`, open by default since 2026-09-11 (rate-limited + email-verification-gated; `TENANT_SIGNUP_CODE` is now an opt-in way back to the original invite-only mode — see "Self-serve signup" below); one demo user (`demo@mytrima.com` / `demo1234`) is still seeded at boot for the dashboard's login form, clearly marked `DEMO ONLY` |
| `CustomerModule` | `POST /customers`, `GET /customers/:tenantId` (list, or search with `?q=`), `GET /customers/:tenantId/:customerId`, `PATCH /customers/:tenantId/:customerId`, `GET /customers/:tenantId/:customerId/activity` | A real minimal CRM now — create, get, edit, search, and a customer activity view (see "A real minimal CRM" below). Deliberately still not built: conversation history (no messaging integration exists to have any) and merge/dedup (no product spec for it, and too risky to guess at). |
| `CatalogModule` | `POST /catalog/:tenantId`, `GET /catalog/:tenantId`, `GET /catalog/:tenantId/:itemId`, `PATCH /catalog/:tenantId/:itemId` | Master Plan Addendum v1.3, §D — no stock/quantity tracking, deliberately, per that section's own scoping |
| `DealsModule` | `POST /deals/:tenantId`, `GET /deals/:tenantId`, `GET /deals/:tenantId/:dealId` | Addendum §F — a deal's catalog items must already exist for the same tenant, enforced by RLS |
| `PettyCashModule` | `POST /vendors/:tenantId`, `GET /vendors/:tenantId`, `POST /petty-cash/:tenantId/replenish`, `POST /petty-cash/:tenantId/pay-vendor`, `GET /petty-cash/:tenantId` | Addendum §G — no reconciliation automation, deliberately (a default applied at sign-off, not a gap) |
| `SalesModule` | `POST /sales/:tenantId`, `GET /sales/:tenantId`, `GET /sales/:tenantId/kpis`, `POST /sales/:tenantId/targets`, `GET /sales/:tenantId/targets`, `POST /sales/:tenantId/benchmarks`, `GET /sales/:tenantId/benchmarks` | Addendum §E — manual entry + CSV-import-ready data model; live vendor POS sync deliberately deferred until a specific vendor is named and verified |

Every in-memory store (`InMemoryConsentStore`, `InMemoryRatingStore`,
`InMemoryAuthUserStore`) implements the same interface its real Postgres-backed
counterpart does, bound via an explicit DI token (`CONSENT_STORE`, `RATING_STORE`,
`AUTH_USER_STORE` — TypeScript interfaces have no runtime representation, so NestJS needs
an explicit token to inject one). This is no longer hypothetical: each `*.module.ts`'s
`useFactory` now picks the real `Pg*Store` the moment `DATABASE_URL` is set and falls back
to `InMemory*` otherwise — see "Wired into the running app — and proven to survive a real
restart" below for how that was actually proven, not just wired.

**Actually booted and hit with real HTTP requests**, not just `app.module.test.ts`'s DI
check — `npm run build && npm start`, then live `curl` calls against the running server:

```
POST /nps        {tenantId, customerId:"c1", score:3, comment:"slow delivery"}
  -> 201 {"category":"detractor","needsFollowUp":true,"notifications":[{...}]}

POST /growth-audit  {tenantId, answers:{}}
  -> 400 {"statusCode":400,"error":"InvalidAuditAnswersError","message":"Missing answers for question id(s): 1, 2, ..."}
  (confirms DomainErrorFilter really converts a thrown domain error into the right HTTP status)

POST /ratings     {tenantId, customerId:"c1", stars:5, comment:"Great!"}
  -> 201 {"id":"...","status":"pending",...}

GET /ratings/t1/aggregate
  -> 200 {"averageStars":0,"count":0}
  (correctly 0 — the rating above is still 'pending', unmoderated ratings don't count)
```

### Automation & Notification Engine: triggers only, not delivery

Master Plan Section 6 describes this as "workflow triggers from audit findings and
customer behaviour." `automation.service.ts` builds exactly that — pure functions
deciding whether a Growth Audit result, NPS response, or moderated rating is worth a
notification, and what it should say — reusing `nps.service.ts`'s own `categorize()`
rather than re-deriving the detractor threshold. It does **not** send anything: actual
delivery still depends on WhatsApp (Assumed, Section 8) or email, and any real scheduling
would need the Redis/BullMQ queue Section 4 names, which this scaffold has no runtime
for. Wiring a `NotificationEvent` to an actual channel is separate, later work.

### Auth/RBAC: registration, revocation, and encrypted MFA secrets — all real now

Master Plan Section 10 specifies "OAuth2/OIDC-based authentication" as the target
architecture but never names a specific identity provider to federate with — that's an
unresolved decision, not a confirmed vendor integration. Rather than guess a provider,
this module builds everything that decision doesn't block. "Sign in with Google/Microsoft"
federation is **not** implemented; it would add a new login path that, on success, calls
the same token-issuing code already here.

**Both gaps this section used to flag are now closed:**

- **Refresh-token revocation, with rotation-on-use.** Every refresh token now carries a
  unique `jti`; `RevokedRefreshTokenStore` (`in-memory-revoked-token.store.ts` when
  `DATABASE_URL` is unset, real Postgres-backed `pg-revoked-token.store.ts` — against
  `db/migrations/0004_refresh_token_revocation.sql` — when it is) tracks which are no
  longer valid. `refresh()` revokes the token it was just given the moment it issues a new
  pair — a refresh token can only ever be used once, closing the real replay risk of a
  leaked-but-unused token being reusable indefinitely. A new `logout()` method revokes a
  token on demand. **Live-verified**, not just unit-tested: logging in, then logging out,
  then trying to refresh with that same token returns a real 401 `"Refresh token has been
  revoked"` — and using a refresh token twice in a row (without logout) fails the same way
  on the second use. **This store was the last of the four (`Consent`/`Rating`/`AuthUser`/
  `RevokedRefreshToken`) still on in-memory-only even in Postgres mode — now closed, and
  proven the same rigorous way as rating persistence earlier**: logged in, refreshed once
  (rotating and revoking the original token), confirmed the real row in
  `revoked_refresh_token` via `psql` directly, killed the server process (verifying its
  PID first), confirmed port 3000 was genuinely free, rebuilt and restarted fresh, verified
  the *new* process's PID owned the port, then retried that same original refresh token —
  still correctly rejected with `"Refresh token has been revoked"`, on a process that never
  saw that login happen. Building the real store surfaced the same tenantId gap as
  `ConsentStore`/`RatingStore`/`AuthUserStore` before it: the interface originally took
  only a `jti`, but the real table has RLS and `NOT NULL tenant_id`/`user_id` columns, so
  `isRevoked`/`revoke` now take `tenantId` (and `revoke` takes `userId` + `expiresAt`) too
  — both already available from the verified JWT payload at every call site, so this cost
  callers nothing.
- **The MFA secret is now actually encrypted at rest**, not just flagged as needing to
  be. `mfa-secret-crypto.ts` uses AES-256-GCM (authenticated encryption — a tampered
  ciphertext fails to decrypt rather than silently returning garbage) to encrypt the
  secret before it's ever saved, and decrypt it only at the moment a TOTP code needs
  verifying. **What's not fully closed**: the encryption key itself still needs a real
  secrets manager — `auth.module.ts`'s dev fallback *generates a fresh random key on
  every process restart*, which would silently lock every Owner out of MFA after a
  restart in a real deployment. Flagged loudly in that file; must become a required,
  persisted env var before this goes near production.

**Registration and MFA enrollment are also real now**, not just login against a
pre-seeded user:
- `POST /auth/register` — hashes the password, enforces a minimum length (8 characters,
  per NIST 800-63B's length-over-complexity-rules guidance), rejects a duplicate email
  within the same tenant. **Live-verified, and caught a real bug in the process**: the
  first working version returned the full user record — including the password hash —
  straight in the HTTP response. Fixed by having `register()` return an explicitly
  narrowed `PublicAuthUserRecord` shape, the same fix pattern as MoPay's `getSession` API
  key leak, with the same kind of regression test guarding it.
- `POST /auth/mfa/enroll/start` + `POST /auth/mfa/enroll/confirm` — two-step by design:
  starting enrollment generates and stores a secret but leaves `mfaEnabled: false`, so a
  login can't start demanding a code before the user has proven (by submitting one valid
  code back) that they actually captured the secret in their authenticator app.
- **CLOSED: both MFA enrollment endpoints now sit behind a real auth guard.**
  `AccessTokenGuard` (`access-token.guard.ts`) validates the caller's own access token
  (`Authorization: Bearer <token>`) and derives `tenantId`/`userId` from *that* — the
  request body no longer carries them at all, so there is nothing left for a caller to
  set to someone else's id. **Live-verified through the actual running dashboard, not
  just unit tests**: logged in as the demo account, called `/auth/mfa/enroll/start` with
  a request body deliberately naming a different `tenantId`/`userId` — the body was
  silently ignored and the enrollment was created against the real caller's own identity
  (confirmed by the returned `otpauthUrl` naming `demo@mytrima.com`, not the injected
  values). Then registered a second, unrelated real account, logged in as *them*, and
  confirmed their own real access token cannot complete "the demo account's" enrollment
  even holding a genuinely valid TOTP code for the demo account's secret — rejected with
  `MfaEnrollmentRequiredError`, because that second account never started its own
  enrollment and so has no secret to check any code against. A missing/malformed/expired/
  wrong-type (refresh, not access) token is rejected the same way login already is — 401
  via the existing `InvalidTokenError`/`TokenExpiredError` mapping, no new error-handling
  surface added. 6 new tests (`access-token.guard.test.ts`) plus a full end-to-end
  regression test in `app.module.test.ts` proving this exact cross-account scenario
  through the real DI-wired guard + controller + service + store, not a mocked stand-in.
  The dashboard's new "MFA Enrollment" card exercises the same flow by hand — including a
  real, dependency-free RFC 6238 TOTP generator written directly against the browser's
  Web Crypto API, so clicking through the demo needs no external authenticator app.
  **What this does NOT close**: there is still no route-level RBAC check (`rbac.ts`'s
  `authorize()`) in this guard — it only proves *who* the caller is, not that their role
  permits the action. Fine here (any authenticated user may enroll their own MFA by
  design); a guard reused for a permission-gated route would need `authorize()` too.
- **CLOSED: `/auth/register` is no longer wide open.** It used to accept
  `tenantId`/`role` as plain request-body fields with zero authentication — anyone could
  self-register as `'owner'` for any tenant they named. It now sits behind
  `AccessTokenGuard` plus `rbac.ts`'s `authorize()` against `'user:manage'`: only an
  authenticated `owner`-role caller may register a new account, and only into their own
  tenant (from their verified token, never the body). This is `authorize()`'s first real
  caller anywhere in this codebase — it existed and was unit-tested (`rbac.test.ts`) since
  early in this project, but nothing had actually invoked it until now. **Live-verified
  against the running server**: an unauthenticated request that used to succeed now
  returns a real 401; logged in as the seeded demo `staff` account and confirmed a real
  403 `InsufficientPermissionError` attempting to register an `owner` for an injected
  tenant id (which was structurally unreachable anyway — `tenantId` no longer comes from
  the body). The legitimate `owner`-invites-`staff` path is proven end-to-end through the
  real DI container in `app.module.test.ts`: bootstrap an owner, enroll and confirm their
  MFA for real, log in with a real TOTP code, then use that owner's verified identity to
  register a new staff account that can immediately log in itself.
  **CLOSED separately** (Master Plan Addendum v1.3, Section H): a brand-new tenant's very
  first account used to have no existing owner to authenticate as, so nothing could call
  this endpoint to create one — that was tenant provisioning, not "invite a teammate," a
  genuinely different, previously-unscoped problem. `POST /auth/tenants`
  (`auth/tenant.service.ts`) is the deliberately separate, signup-code-gated endpoint
  that closes it — see "Sales, Deals, Petty Cash & Tenant Onboarding" below. `DEMO_TENANT_ID`'s
  own seed account still bootstraps via a direct `AuthUserStore.save()` call in
  `auth.module.ts`, unchanged — that's a fixed demo fixture, not a real tenant.
  **CORRECTION, 2026-09-10**: `POST /auth/tenants` creating a real owner was proven above
  only via unit tests calling `AuthService` methods directly — actually driving that same
  owner through the real HTTP API turned up a real lockout bug (a fresh owner had no way
  to reach the MFA-enrollment endpoints at all). Now fixed and live-verified through the
  real HTTP API with no workaround — see "A real, previously-undiscovered bug: fresh
  owners were locked out of their own accounts" below for the full writeup.

### RLS: proven live — tenant isolation actually works, not just written to

`0001_tenant_and_rls.sql` originally shipped with `USING`-only policies — a flagged,
known gap (a session could still insert a row for a different tenant if the app forgot
to scope it). Every policy now carries a matching `WITH CHECK` clause, and the old manual
test procedure (`db/tests/rls_negative.test.md`) has been converted into an automated
script (`db/tests/rls_negative.sql`).

**This has now actually been run — for real — against a local PostgreSQL 17 instance,**
installed specifically to close this gap rather than leave the single most important
security claim in this scaffold as "written but unverified":

```bash
# Real non-superuser role — a superuser bypasses RLS entirely, which would make
# every assertion below pass vacuously without RLS ever being exercised.
psql -d mytrima -c "create role mytrima_app login password '...'; \
  grant select, insert, update, delete on all tables in schema public to mytrima_app;"

psql -d mytrima -f db/tests/rls_negative.sql
# -> RLS negative test passed
```

That result means, genuinely, not assumed: a Tenant-A-scoped session saw exactly its own
row, could not see Tenant B's row by any means tried, **and a cross-tenant INSERT attempt
was actually rejected by the `WITH CHECK` clause** — the specific gap this whole test
exists to catch.

**A real bug was caught and fixed in the process**: `0001_tenant_and_rls.sql` used the
`citext` type on email columns without ever creating the citext extension, which fails
immediately on a real database with `ERROR: type "citext" does not exist`. This is exactly
the kind of thing "written and reviewed for syntax" cannot catch and only actually running
it does — fixed by adding `create extension if not exists "citext";`, then re-verified by
re-running the migration until every statement succeeded.

**Also now run for real, not just locally**: the CI job in `.github/workflows/ci.yml` that
wires this same script into a GitHub Actions Postgres service container. This scaffold had
no git repository at all until this pass — `git init`, an initial commit of the full
codebase, a real GitHub repository, and a real push all happened here for the first time.
The resulting first-ever Actions run
([run #1](https://github.com/rmotsasa-svg/mytrima-platform/actions/runs/34267258451)):
**Status: Success**, all four jobs green in 33s — `test-and-typecheck` (the 161 of 200
tests that need neither TEST_DATABASE_URL nor TEST_REDIS_URL — this CI job doesn't set
either, so the remaining 39 correctly skip, exactly as designed) and
`db-rls-negative-tests` (a genuinely fresh Postgres 16 service container, migrations
applied for real, the RLS negative test genuinely passing) both proven on real GitHub
infrastructure, not simulated. `dependency-and-secret-scan` and `sast` are still honest
placeholders (their own steps say so) — this run didn't change that, only confirmed the
two real jobs actually work.

### Real Postgres-backed stores — and four more real bugs found by actually building them

With a real database available, `ConsentStore`, `RatingStore`, and `AuthUserStore` all
now have real Postgres-backed implementations (`pg-consent.store.ts`,
`pg-rating.store.ts`, `pg-auth-user.store.ts`), sharing one helper
(`src/common/postgres.ts`) that runs every query inside a transaction with
`app.current_tenant_id` set via `set_config(..., true)` — transaction-scoped, not
session-scoped, which is specifically what makes this safe under a shared connection
pool. **All of it is live-tested against the real local instance, gated behind
`TEST_DATABASE_URL` so `npm test` stays green on any machine without one:**

```bash
TEST_DATABASE_URL="postgresql://mytrima_app:<password>@localhost:5432/mytrima" npm test
```

**Building these surfaced four more real bugs — the exact pattern this whole project is
built around, repeated at the persistence layer:**

1. **`app_user` was missing a `password_hash` column entirely.** `AuthUserRecord` has
   required one since `auth.service.ts` was first written; the migration never actually
   added it. Fixed in `db/migrations/0005_auth_password_hash.sql`, found only by trying
   to write `PgAuthUserStore.save()` for real.
2. **`ConsentStore.revoke(id, revokedAt)` had no tenantId.** Harmless in-memory (a Map
   key is globally unique there), but under real RLS, a query with no tenant context set
   sees nothing — the row is invisible, so the `UPDATE` would silently affect zero rows
   and revocation would just quietly never work. Fixed by adding `tenantId` to the
   interface, `ConsentService.revoke()`, and the `/consent/:id/revoke` endpoint body —
   with a regression test proving a wrong-tenant revoke now correctly does nothing.
3. **`RatingStore.updateStatus(id, ...)` had the identical gap** — fixed the same way,
   threaded through `RatingService.moderate()` and the `/ratings/:id/moderate` endpoint
   body (and the dashboard's own JS, which called it).
4. **`AuthUserStore.findById(id)` had the identical gap**, used by `refresh()` and both
   MFA enrollment methods. `refresh()` already had a `tenantId` available from the JWT
   payload; the MFA enrollment endpoints did not, which surfaced a fifth, more general
   issue while fixing it: **those endpoints take `tenantId`/`userId` as plain request
   fields with no auth guard verifying the caller actually is that user** — flagged
   inline as a known gap, not fixed here (a real fix needs an access-token-validating
   guard deriving these values, not trusting body input). **Since closed** — see
   "Auth/RBAC" above for `AccessTokenGuard` and its live cross-account verification.

None of these four would have been caught by the extensive in-memory unit test suite —
in-memory Maps don't care whether a caller supplied the right tenant, and none of them
have RLS to enforce it. They only surfaced by actually writing real SQL against a real,
RLS-enabled database.

### Wired into the running app — and proven to survive a real restart

The three Postgres-backed stores above are now actually bound into the live NestJS app,
not just tested in isolation. `DatabaseModule` (`src/common/database.module.ts`) provides
one shared `PG_POOL`, `null` when `DATABASE_URL` is unset. Each feature module's
`useFactory` picks `Pg*Store` when the pool exists and `InMemory*Store` otherwise, so the
app boots with zero configuration exactly as before, and switches to real persistence the
moment `DATABASE_URL` is set — "the stores are real and tested" and "the app uses them"
are no longer two separate claims.

**This was actually proven, not assumed**, and doing so surfaced two more real findings:

1. **A stale process, not a code bug, produced a false result on the first attempt.** An
   old `node dist/main.js` from earlier in the session was still listening on port 3000
   (no `DATABASE_URL`, in-memory only). Every `curl` request — including a first
   "persistence survives restart" check — was silently hitting that ancient process, not
   the newly-started one, because the new process's `node dist/main.js &` launch had died
   instantly on `EADDRINUSE` without being noticed. This produced a demo-login failure
   that looked like a real bug (the stale process's seeded user was keyed to the old `"t1"`
   tenant literal, not the new `DEMO_TENANT_ID` UUID) and would have produced a
   false-positive "restart survived" result for the same reason. Root-caused by checking
   `Get-NetTCPConnection -LocalPort 3000`'s `OwningProcess` against the PID actually
   printed by the new process's own boot log — they didn't match. Killed the stale PID,
   confirmed the port was genuinely free, restarted, and re-verified the owning PID before
   trusting any further response. **Lesson applied going forward: before treating any
   `localhost:3000` response as proof of anything, first confirm the PID answering the
   port is the PID you just started.**
2. **`rating.customer_id` has a real foreign-key constraint, and nothing in this app could
   create a `customer` row.** Submitting a rating against a random, never-inserted
   `customerId` correctly failed with
   `violates foreign key constraint "rating_customer_id_fkey"` — the in-memory store never
   enforced this, so it was invisible until Postgres was real. This wasn't a rating-module
   bug; it was a concrete instance of a gap already known at the architecture level: Master
   Plan Section on CRM & Customer Data has no full implementation yet, and there was no
   endpoint anywhere in this app that could create a customer. **Now closed**: `CustomerModule`
   (`POST /customers`, `GET /customers/:tenantId`) exists — see its row in the modules table
   above — and the dashboard's Ratings card now picks a real customer from a dropdown fed by
   that endpoint instead of accepting an arbitrary typed `customerId`, which is exactly what
   produced the original failure. A full CRM (search, edit, merge, conversation history) is
   still not built; this is deliberately the minimum that makes the FK constraint satisfiable.
   **Building `CustomerModule` surfaced one more real bug, closing the loop this section is
   about**: `InvalidCustomerError` (thrown when none of displayName/phone/email is given) was
   missing from `DomainErrorFilter`'s `STATUS_BY_ERROR_NAME` map, so it fell through to the
   unmapped-error 500 default instead of the 400 a validation error should be — caught by
   live-`curl`-ing the endpoint, not by the unit tests (which construct the error directly and
   never touch the filter). Fixed by adding the missing map entry, with a regression test.

With a real `customer` row inserted by hand to satisfy that constraint, the actual proof
was run end to end: submit a rating → moderate it → confirm the aggregate
(`{"averageStars":4,"count":1}`) → kill the server process (verifying its PID via
`Get-NetTCPConnection` first) → confirm port 3000 was genuinely free → rebuild and restart
fresh → verify the *new* process's PID owns port 3000 → query the aggregate again with no
data resubmitted. It came back identical — `{"averageStars":4,"count":1}` — and the demo
login worked against the same fresh process too. That is genuine cross-restart Postgres
persistence, not an assumption.

### Growth Audit now persists — and a real jsonb serialization bug it caught

The Growth Audit scoring engine (`growth-audit.service.ts`) has been pure, tested logic
since this scaffold's first version — but nothing ever remembered a result past the
single request that computed it, even though `growth_audit_response` has existed, with
RLS, since migration 0001. `GrowthAuditService` now wraps `scoreAudit()` with a real
store (`InMemoryGrowthAuditResponseStore` / `PgGrowthAuditResponseStore`, the same
DATABASE_URL-gated pattern as every other module); `POST /growth-audit` persists a
submission and `GET /growth-audit/:tenantId` lists a tenant's history.

**Building the real store caught a genuine bug on the first real insert attempt**:
`error: invalid input syntax for type json`. `section_scores` (an array of per-section
results) is a jsonb column, and node-postgres does NOT automatically serialize every JS
value to JSON on the way in — a plain object gets `JSON.stringify`'d automatically, but a
plain JS **array** gets encoded as a *Postgres array literal* (`{...}`) instead, because
pg's parameter serializer can't tell "this array is going into a jsonb column" from "this
array is going into a real Postgres array column" — it only sees a JS array. That literal
isn't valid JSON, so Postgres rejected it outright. Fixed by explicitly
`JSON.stringify`-ing both jsonb fields (`answers` and `section_scores`) before they reach
node-postgres, rather than relying on its (here, wrong) automatic serialization — a
genuine gotcha worth remembering for any future jsonb column that stores an array.

**Live-verified with the same restart rigor as the rating/customer work above**: submitted
a real audit (all-4s, scoring 100/High-Growth) → confirmed it listed correctly *before*
restart → killed the server (verifying its PID first) → confirmed port 3000 was genuinely
free → rebuilt and restarted fresh → verified the *new* process's PID owned the port →
queried the history again with nothing resubmitted. It came back identical — same score,
same band, all 7 sections round-tripped correctly through jsonb. Then clicked through the
same flow in the actual dashboard (a new "Refresh Past Audits" table on the Growth Audit
card): submitted a second, different audit (all-0s, Critical) through the real UI and
watched the history table pick up both rows live.

**Known gap, deliberately not built here**: `GrowthAuditController` has no auth guard, so
`administered_by` (nullable in the schema) is never set — there's no verified caller
identity to attribute a submission to yet. Adding that would mean putting this endpoint
behind `AccessTokenGuard` first, not attempted in this pass to keep the change scoped to
persistence alone.

### Rating moderation now fires a real notification — and a genuine dashboard-breaking bug it caught

`RatingController`'s moderate endpoint used to carry an inline KNOWN GAP comment: it
couldn't produce a `notificationsForModeratedRating` event (`automation.service.ts`)
because `RatingStore` had no `findById` to look up a rating's own `customerId`/`stars`
from just the id the moderate request receives. `RatingStore.findById(tenantId, id)` now
exists (in-memory and Postgres, same tenantId-scoping reasoning as `updateStatus()`), and
`RatingService.moderate()` returns the updated `Rating` itself rather than `void`, so
`RatingController` can call `notificationsForModeratedRating()` the same way
`GrowthAuditController`/`NpsController` already do. **Live-verified**: moderating a rating
to `'hidden'` now returns a real `NotificationEvent` naming the correct customer and star
count; moderating to `'public'` still correctly returns none. A wrong-tenant or unknown id
still moderates nothing and returns no notifications, exactly as before this change.

**Wiring this into the dashboard surfaced a real, independent bug — this time in the
dashboard's own JavaScript, not the API.** Showing the notification via `alert()` meant
adding `.join('\n')` inside `moderateRating()`'s source. That source itself lives inside
`app.controller.ts`'s own *outer* TypeScript template literal (`DASHBOARD_HTML`) — and a
template literal interprets `\n` as a real newline character at **compile time**, not as
the literal two-character escape sequence a nested JS string needs. The result: the
*served* HTML had an actual line break sitting in the middle of a single-quoted JS string,
which broke the entire inline `<script>` tag with a SyntaxError the moment any browser
tried to parse it — not just the one function, the whole dashboard (confirmed live:
`tenantId is not a function`, every button on the page dead). Fixed by escaping the
backslash itself in the source (`'\\n'`), so the *output* JS the browser receives contains
the correct two-character `\n` escape. **No test in the existing suite could have caught
this** — nothing had ever parsed the dashboard's inline script as JavaScript, only ever
string-concatenated it. Added `src/app.controller.test.ts`, which does exactly that
(`new Function(script)` against the real served HTML) — confirmed, not just asserted, to
actually catch this exact class of bug: reintroduced the single-backslash version
temporarily, watched the new test fail, then reverted and watched it pass again.

### A real minimal CRM — get, edit, search, and a real partial-update bug it caught

`CustomerModule` started as create-and-list only — enough to satisfy `rating.customer_id`'s
foreign key and nothing more. It's now a genuinely useful minimal CRM:

- **`GET /customers/:tenantId/:customerId`** — get one customer, a real 404
  (`CustomerNotFoundError`, newly added to `DomainErrorFilter`'s map) for an unknown or
  wrong-tenant id.
- **`PATCH /customers/:tenantId/:customerId`** — edit a customer's fields.
- **`GET /customers/:tenantId?q=...`** — the same list endpoint, now filtering by a
  case-insensitive substring match on name/phone/email when `?q=` is given. Deliberately a
  plain in-memory filter over the tenant's full list, not indexed database search — Master
  Plan Section 2's own stated principle ("right-size before scale... the pilot serves 5–10
  tenants") is exactly the case for not building search infrastructure a pilot-scale
  customer list doesn't need yet.
- **`GET /customers/:tenantId/:customerId/activity`** — a "customer 360" view assembling
  that customer's own ratings and consent records — `RatingModule`/`ConsentModule` now
  export their services specifically so `CustomerModule` can inject and query them for
  this, real data from real modules, not a new table invented for the purpose.

**A genuine bug found only by live-curling the running server, not by the unit tests**:
the first working version of `update()` treated every `PATCH` as a full replace —
unconditionally overwriting all three fields (`displayName`/`phone`/`email`) on every
call. `PATCH`ing just a new `displayName` silently wiped a real customer's `phone` and
`email` to null, both in-memory and in the real Postgres row, because a field the caller
never mentioned (`undefined`) was treated identically to "clear this field." The existing
unit test happened to always resend every field together, so it never exercised the
partial case. Fixed by distinguishing "left out of the call" (keep the existing value)
from "explicitly sent as an empty string" (an intentional clear) — the "at least one
identifying field" rule is checked against the *resulting* record, not the raw arguments,
so clearing a customer's only identifying field is still rejected. **Live-verified against
real Postgres**: created a customer with a phone number, `PATCH`ed only `displayName` and
`email`, confirmed the phone column survived untouched — both immediately and via a
separate `GET` afterward.

**Deliberately not built, and why** (see this file's own top comment in
`customer.service.ts` for the fuller reasoning): conversation history — Master Plan
Section 5 assigns actual message logging to a separate Messaging Service, and there is no
conversation data anywhere in this system yet since WhatsApp integration itself is still
"Assumed," so aggregating it here would mean inventing data that doesn't exist; and
merge/deduplication of two customer records, which has no product spec anywhere in the
Master Plan and is a genuinely high-risk operation to guess at — what should happen to two
customers' existing ratings and consent history on merge is exactly the kind of decision
POPIA accountability likely cares about, not something to bake into code no one asked for.

### NPS responses now persist

`nps.service.ts`'s `categorize()`/`needsFollowUp()`/`computeNps()` have been pure, tested
functions since this scaffold's NPS logic was first written — real and correct for scoring
a single submitted response, but with nothing to aggregate over via HTTP, since no
`NpsResponse` repository existed. Migration 0006 adds `nps_response` (RLS included from
the start, same tenant-isolation pattern as every other table); `NpsService` wraps the same
pure functions with real persistence (in-memory, or `PgNpsResponseStore` when
`DATABASE_URL` is set), exactly the pattern `GrowthAuditService` already established
around `scoreAudit()`. `POST /nps` now persists a submission; the new
`GET /nps/:tenantId/aggregate` exposes the tenant-wide NPS number `computeNps()` could
always compute but had nothing real to compute over. `customer_id` is a real foreign key,
same as `rating.customer_id` — an NPS response needs a real customer to attach to.

**Live-verified with the same restart rigor as every other persistence change in this
project**: submitted a promoter (score 9) and a detractor (score 2) — confirmed the
aggregate (`{"nps":0,"count":2}`, correctly 50%−50%=0) *before* restart — killed the server
(verified PID first) — confirmed port 3000 was genuinely free — rebuilt and restarted fresh
(verified the *new* PID owned the port) — queried the aggregate again with nothing
resubmitted. It came back identical. Then clicked through the same flow in the actual
dashboard: the NPS card's free-text `customerId` field was replaced with the same
real-customer dropdown pattern Ratings already uses (both now share one
`populateCustomerSelect()` helper), submitted a real detractor response through the UI, and
watched the aggregate auto-refresh to `{"nps":-33,"count":3}` — the correct math for
1 promoter / 2 detractors out of 3.

### Real notification delivery: BullMQ, a real queue, and a Memurai discovery

Master Plan Section 4 names Redis/BullMQ specifically for the Automation & Notification
Engine's job queue. Every `notificationsFor*()` function in `automation.service.ts` has
been correct since this scaffold's first version — deciding *whether* and *what* to
notify — but nothing ever did anything with the result beyond returning it in the HTTP
response. No background delivery mechanism existed at all.

**A genuine discovery before any of this was built**: this machine already had a
Redis-compatible server installed and running. Attempting to install Memurai (a
Windows-native, Redis-protocol-compatible server) to test this properly, the installer
failed with `LaunchConditions: A newer version of Memurai For Redis is already
installed.` Checked directly: a `Memurai` Windows service was already `Running`, genuinely
listening on `127.0.0.1:6379`, and answered a real `PING` with `PONG` (Memurai 8.1.242,
Redis-protocol-compatible version 8.2.7) — no install was actually needed.

`src/common/queue.module.ts` provides a single shared BullMQ `Queue`, gated on
`REDIS_URL` exactly like `DatabaseModule` gates `PG_POOL` on `DATABASE_URL` — `null` when
unset, so the app boots and every notification-producing endpoint works exactly as before
with zero configuration. `NotificationDeliveryService.enqueue()` is now called by
`GrowthAuditController`, `NpsController`, and `RatingController` right after computing
notifications; when a real queue exists, each `NotificationEvent` becomes a real BullMQ
job. `NotificationWorkerService` runs a real in-process BullMQ `Worker` (no separate
worker deployment exists for this pilot-scale scaffold — Master Plan Section 2's own
"right-size before scale" principle) that picks up each job and genuinely attempts
delivery.

**A real dependency-resolution bug found only by running the real-Redis-gated tests**:
`npm install bullmq` alone compiles fine but throws at runtime the moment a `Queue`/
`Worker` actually tries to connect — `bullmq@6` treats `ioredis` as an *optional* peer
dependency it loads dynamically, not a bundled one. Fixed by installing `ioredis`
directly; documented in `package.json`'s own notes so a future dependency bump doesn't
silently reintroduce this.

**At the time this section was first written, every delivery attempt was expected to
fail, on purpose** — the honest, correct outcome then, not a bug papered over.
`deliverNotification()` called the `NotYetVerifiedWhatsAppService` stub, which threw
`PendingVerificationError`: WhatsApp Business API was still "Assumed" per Master Plan
Section 8, with access route, cost, and template-approval turnaround unconfirmed — and
there was no confirmed template to compose a real message against. What that pass proved
was real even so: a notification computed by a controller genuinely reached a real
background job, processed by a real worker outside the request/response cycle — exactly
the mechanism Section 4 calls for, with the last mile (an actual message reaching a
customer's phone) honestly blocked on the vendor decision, not the queue.

**UPGRADED 2026-09-10: WhatsApp Business API moved from "Assumed" to a real client**,
same pattern as MoPay/Meta Graph API before it — see "WhatsApp: from 'Assumed' to a real,
live-verified send" below for the full client and live-verification writeup. This section
now describes what changed in the delivery pipeline itself to actually use it:

- `NotificationEvent` was always addressed to *tenant staff*, never the customer directly
  (see `automation.service.ts`'s own comment) — but nothing above the individual
  `customer` row had ever stored a phone number to actually send that to.
  `TenantRecord.notificationPhoneE164` (migration `0014_tenant_notification_phone.sql`,
  one number per tenant — not per staff member, same pilot-scale right-sizing as the
  shared signup code) closes that gap. Owner-only, set via the real, previously-unused
  `tenant:manage_settings` permission through `PATCH /auth/tenants/notification-phone`.
- `deliverNotification()` now resolves the tenant's phone via `TenantStore.findById()`
  first — a tenant that hasn't set one fails loudly with the new
  `NotificationPhoneNotConfiguredError`, not a silent no-op or a guessed recipient.
- With a phone configured AND `WHATSAPP_PHONE_NUMBER_ID`/`WHATSAPP_ACCESS_TOKEN` set, a
  job now genuinely **succeeds** — sending Meta's own pre-approved `hello_world` sample
  template, since no real, business-specific, Meta-approved template exists yet (Meta
  requires template approval before a business-initiated send outside a customer-service
  window — see the client section below). This is an honest, documented limitation, not a
  silent one: the notification's real `message` content is not what gets delivered until a
  real template is submitted and approved.

**Live-verified against the real running server, real Redis, and the real WhatsApp Cloud
API, end to end**: registered a real tenant, set its real `notificationPhoneE164`, then
`POST /nps` with a detractor score enqueued a real `NotificationEvent` — the real worker
picked it up, resolved the real phone, and called the real WhatsApp Cloud API, which
delivered a real WhatsApp message to a real phone (confirmed received). No failure was
logged (the worker only logs failures), and receipt was independently confirmed on the
actual device. See "WhatsApp: from 'Assumed' to a real, live-verified send" below for the
raw API proof this pipeline is built on.

**Earlier proof this pipeline's queue infrastructure itself is real, kept for the
historical record**: before the WhatsApp client existed, a real NPS detractor response and
a real rating moderated to `hidden` were submitted against the real running server — both
produced real `NotificationEvent`s, both were genuinely enqueued, and the server's own log
showed the real worker picking up and failing each one with the exact expected reason
(`Notification job 1 (nps_detractor_followup) failed: WhatsApp Business API is not
implemented...`). `memurai-cli` was checked directly, not just the application's own log:
real BullMQ keys (`bull:notifications:1`, `bull:notifications:failed`, ...) genuinely
existed in Redis, with `HGETALL bull:notifications:1` showing the real job data, the real
failure reason, and a real stack trace pointing at the actual compiled code that ran.

### Revoked-refresh-token cleanup: a real scheduled job, and a systemic Postgres/RLS bug it surfaced

`db/migrations/0004_refresh_token_revocation.sql` flagged a known gap since it was first
written: nothing ever deleted a `revoked_refresh_token` row once its `expires_at` passed,
so the table would grow forever at real volume holding rows that can no longer possibly
matter. `auth/revoked-token-cleanup.service.ts` closes it: a real BullMQ job scheduler
(`queue.upsertJobScheduler(...)`, BullMQ v6's replacement for the old `add(..., {repeat})`
API — found only by running `tsc` and reading `bullmq`'s own `.d.ts` files, not guessed)
runs `deleteExpired()` once a day, active only when both `DATABASE_URL` and `REDIS_URL`
are set, same double-gated pattern as everything else.

**Building this surfaced a previously-undocumented, genuinely dangerous Postgres
behavior**, found only by hitting it while writing `deleteExpired()`'s first version (a
single unscoped `DELETE FROM revoked_refresh_token WHERE expires_at < now()` across every
tenant at once): a pooled connection that has **ever** run a transaction-scoped
`set_config('app.current_tenant_id', ...)` reverts, after `COMMIT`, to an **empty
string** for `current_setting(..., true)` — not `NULL`, unlike a truly fresh connection.
Confirmed directly, not assumed:

```sql
-- Fresh connection:
select current_setting('app.current_tenant_id', true) is null; -- TRUE (NULL)
-- Same session, after a transaction-scoped set_config + COMMIT:
begin; select set_config('app.current_tenant_id', '<uuid>', true); commit;
select current_setting('app.current_tenant_id', true) is null; -- FALSE (empty string, not NULL)
```

An RLS policy's `tenant_id = current_setting(...)::uuid` then throws `invalid input
syntax for type uuid: ""` on that reused connection, rather than the harmless "sees
nothing" a genuinely-`NULL` setting produces. **No plain (non-`runWithTenantContext`)
query may ever touch an RLS-protected table on a pooled connection, even for a
legitimately cross-tenant maintenance operation** — `deleteExpired()` is fixed to instead
list tenants first (`tenant` itself carries no RLS) and loop per-tenant through
`runWithTenantContext`, exactly right-sized for Master Plan Section 2's pilot scale
(5–10 tenants). Documented in detail directly in `src/common/postgres.ts`'s own comment.

**This also turned out to be systemic, not confined to the new file**: grepping the whole
`src` tree for the same "plain `DELETE FROM tenant WHERE id = ...` in a test's cleanup"
pattern — which cascades (via `ON DELETE CASCADE`) into RLS-protected child tables and
hits the identical error — found it in **9 files, 22 occurrences total**, previously
silent only because of which physical connection the pool happened to hand back, not
because the pattern was actually safe:
`revoked-token-cleanup.service.test.ts`, `pg-nps-response.store.test.ts`,
`pg-customer.store.test.ts`, `pg-rating.store.test.ts`,
`pg-growth-audit-response.store.test.ts`, `pg-revoked-token.store.test.ts`,
`pg-auth-user.store.test.ts`, `pg-consent.store.test.ts`, and `postgres.test.ts` itself
(the file specifically written to stress-test connection reuse with `max: 1` — the one
most likely to trigger it). All 22 fixed the same way: wrapped in `runWithTenantContext`.
While auditing `revoked-token-cleanup.service.test.ts`'s own worker-integration test, two
more real bugs surfaced alongside this: a plain `INSERT` that would have failed RLS's
`WITH CHECK` outright, and a plain final `SELECT` that would have passed **vacuously**
(RLS hides every row under no tenant context, so "0 rows remaining" would be true whether
or not `deleteExpired()` actually worked) — both fixed the same way.

**Live-verified against the real running server, restart included**: started the real
compiled server against live Postgres + Redis; its own `RevokedTokenCleanupService`
immediately logged `Deleted 0 expired revoked_refresh_token row(s)` on boot (BullMQ's job
scheduler runs once immediately on creation). Inserted a real expired row directly via
`psql`, manually enqueued one `delete-expired-revoked-tokens` job on the same queue the
live worker listens for (without waiting 24 hours for the schedule), and the running
server's own log showed `Deleted 1 expired revoked_refresh_token row(s)` — confirmed
independently via a direct `psql` query, not just the app's own claim, that the row was
genuinely gone. Killed the process and restarted it fresh: clean boot, zero errors, and
the job scheduler correctly did **not** re-fire immediately a second time (`upsertJobScheduler`
is idempotent on the same scheduler id — it updates the existing schedule rather than
re-triggering), exactly the intended behavior across a real restart.

### CI: from honest placeholders to real scanners

`dependency-and-secret-scan` and `sast` in `.github/workflows/ci.yml` were real
placeholders (plain `echo` statements, not fake passes) until this pass — Master Plan
Section 9/11 requires both as real CI gates that block merge, not just aspirational text.

**`dependency-and-secret-scan`** now runs [`audit-ci`](https://github.com/IBM/audit-ci)
(a real `devDependency`) against `audit-ci.jsonc`. Verified locally both directions before
trusting it: `npx audit-ci --high` (no allowlist) genuinely exits `1` against this
project's real current dependency tree — 4 real high-severity advisories, all the same
root cause (`multer`, a transitive dependency of `@nestjs/platform-express` that this app
never actually calls — confirmed via `grep -r "multer\|FileInterceptor\|UploadedFile"
src/` returning nothing, and none of the advisories are reachable without a file-upload
endpoint that doesn't exist here). `npm audit fix --force`'s only available fix downgrades
`@nestjs/core` from 11.2.3 to 7.5.5 — four major versions back, not viable. `npx audit-ci
--config audit-ci.jsonc` genuinely exits `0`, allowlisting exactly the 3 advisories at
"high" severity or above (the 4th is "low", already under the gate on its own — `audit-ci`
itself flagged including it as unnecessary, so it was removed rather than left in for no
reason). Anything new still fails the build; this allowlist is documented inline in
`audit-ci.jsonc` and must be revisited the moment this app adds a real file-upload
endpoint. Secret scanning (the other half of this job's name) is **not** wired up yet —
that still needs its own pass (gitleaks or trufflehog), not claimed done here.

**`sast`** now runs a real [Semgrep](https://semgrep.dev/) scan against its public,
no-login-required `p/ci` registry ruleset, with `--error` making any finding fail the
build. **This one could not be verified locally** — Semgrep has no native Windows build,
and this machine has neither Docker nor a usable WSL distro to run it another way (checked
directly: `wsl --version`/`wsl -l -v` show no usable distro, `docker --version` isn't even
installed). Rather than claim a local pass that never happened, this was verified the same
way `db-rls-negative-tests`' real Postgres service container above was: by actually
pushing and checking what GitHub Actions' own Linux runner does with it.

**[CI run #5](https://github.com/rmotsasa-svg/mytrima-platform/actions/runs/34341580965)
genuinely failed** — and it was a real finding, not a setup bug: Semgrep ran successfully
(160 rules, 123 files) and reported 7 real findings, all the same rule
(`yaml.github-actions.security.github-actions-mutable-action-tag`): every third-party
action in `ci.yml` was referenced by a mutable tag (`@v4`/`@v5`) rather than a pinned
commit SHA — a genuine supply-chain-security gap (the exact class of issue behind the
real-world `trivy-action` and `kics-github-action` compromises), not a Semgrep
false-positive or a misconfigured job. (Reading that log at all needed one extra step:
GitHub requires being signed in to view a job's detailed log even on a public repo, which
this assistant's browser session wasn't — the user signed in so the actual finding could
be read and fixed properly, rather than guessed at.) Fixed by pinning every `uses:` line
to its actual current tag's real commit SHA (looked up via GitHub's own API, not guessed),
tag kept as a trailing comment for readability. **[CI run
#6](https://github.com/rmotsasa-svg/mytrima-platform/actions/runs/34343486942) confirmed
the fix: Status Success, all 4 jobs green in 36s**, including both `sast` and
`dependency-and-secret-scan` passing for real for the first time.

### Sales, Deals, Petty Cash & Tenant Onboarding — Master Plan Addendum v1.3

Six new modules, all signed off in a
[Master Plan Addendum](Mytrima_Technical_Master_Plan.pdf) covering the scope decision
first — Master Plan v1.0's own Section 6 states this codebase does not introduce new
product scope beyond the original grant proposal, so this expansion was named and
approved explicitly, not slid in quietly: **Product/Service Catalog**, **Deals &
promotions**, **Sales & Point of Sale**, **Sales targets**, **Petty cash & vendor
payments**, **KPI benchmarks** (a fourth Automation & Notification Engine trigger), and
**Tenant self-service onboarding**. Same standard as everything else in this file: real
migrations, real Postgres/Redis, real bugs found and fixed, not just written and assumed
correct.

**Five real bugs found running this against real infrastructure, not just written:**

1. **A line item's id was a non-uuid string.** `SaleService.recordSale()`'s first version
   generated each line item's id as `` `${saleId}-${index}` `` — a real `sale_transaction_line_item.id`
   column is `uuid`, and a value like `...-0` fails Postgres's uuid parser outright.
   Fixed by giving every line item its own real `randomUUID()`.
2. **`period_start`/`period_end` were `date`, not `timestamptz`, on both `sales_target`
   and `kpi_benchmark`.** A `date` column silently truncates to midnight on round-trip —
   confirmed directly: a benchmark set for "the last hour" came back from Postgres as
   midnight-to-midnight, a window that excludes every sale that happened after midnight,
   including the one just recorded. `KpiBenchmarkCheckService`'s own real-database test
   caught this: a real sale (total 100) evaluated against thresholds of 5000 and 10
   showed the sale total as 0, breaching *both* thresholds instead of just one. Fixed by
   changing both columns to `timestamptz` in migrations 0009/0011 — a strict
   generalization that still supports whole-calendar-day periods, just no longer
   confined to them.
3. **`mytrima_app` had no `CREATE` privilege, and no DML grant on the 5 new tables.**
   Postgres 15+ revoked `PUBLIC`'s default `CREATE` on schema `public`, so every
   migration (0001 onward) has only ever actually run as the `postgres` superuser, not
   the app's own runtime role — and that role also had no `select`/`insert`/`update`/`delete`
   grant on tables created after its original one-time grant. Documented in detail, with
   the fix, directly in `db/migrations/0011_kpi_benchmark.sql`'s trailing comment —
   including the `alter default privileges` statement that makes every *future* migration's
   tables grant automatically, run once per real database rather than once per file.
4. **Two of my own new tests forgot `AuthService`'s existing MFA-enforcement rule.**
   `registerTenant()`'s owner account is a real owner account — `AuthService.login()`
   correctly refuses to sign one in until MFA is enrolled, exactly like any other owner.
   My first test asserted an immediate login would work; it doesn't, on purpose. Fixed by
   completing the same enroll → confirm → login-with-TOTP flow every other owner-login
   test in this codebase already uses, not by weakening the rule.
5. **A conversion-rate test used a fixed past period that couldn't contain the data it
   needed.** `RatingService.submit()`/`NpsService.submit()` always stamp `submittedAt` as
   the real "now" — there is no way to backdate it — so a test period fixed to January
   2026 never actually contained either submission, and `conversionRate` correctly (if
   uselessly, for that test) came back `null`. Fixed by scoping the test period around
   the real current time instead of an arbitrary past month.

**Live-verified against the real running server, restart included**: started the real
compiled server against live Postgres + Redis with a real `TENANT_SIGNUP_CODE` set,
then, all via real HTTP requests: created a new tenant through `POST /auth/tenants`
(confirmed a wrong signup code is genuinely rejected with `InvalidSignupCodeError`
first); created a real catalog item; created a real 20%-off deal against it; recorded a
real sale applying that deal — the response showed `subtotalAmount: 150,
discountAmount: 30, totalAmount: 120`, the correct arithmetic, not asserted in a test but
watched happen over HTTP; fetched live-computed KPIs reflecting that real sale; created a
real vendor, replenished petty cash, paid the vendor, and confirmed the ledger's computed
balance (500 − 80 = 420) matched. Set a real KPI benchmark, manually enqueued the same
`check-kpi-benchmarks` job the daily scheduler uses (without waiting 24 hours), and
watched the live server's own log show the full real pipeline firing end to end:
`Checked KPI benchmarks: 1 breach(es) found and enqueued` followed by
`NotificationWorkerService`'s already-familiar `WhatsApp Business API is not
implemented` failure — proving the fourth trigger reaches the exact same real
queue/worker infrastructure the other three already do. Cleaned up the test tenant, then
killed and restarted the process fresh: clean boot, zero errors, every new route mapped
again.

**204/204 → 273/273**: this segment added 69 new tests (52 run unconditionally, 17
gated behind a real Postgres instance) on top of everything already in this file — see
the module table above for the per-file breakdown, and "What was actually built and
verified"'s own top-line count for the reproducible total.

## What is deliberately stubbed, and why

Every file under `src/modules/integrations/` throws `PendingVerificationError` instead
of returning fake success data, for anything not yet a real, confirmed integration. This
is intentional: a mocked integration that "works" in a demo teaches the team to trust
something that was never actually confirmed with the vendor. As of 2026-09-10 this table
is empty — WhatsApp (the last entry here) is now a real, live-verified client
(`WhatsAppCloudApiService`, see "WhatsApp: from 'Assumed' to a real, live-verified send"
above); `NotYetVerifiedWhatsAppService` still exists and is still used as the honest
fallback when `WHATSAPP_PHONE_NUMBER_ID`/`WHATSAPP_ACCESS_TOKEN` aren't configured, same
pattern as every other env-var-gated store/service in this project — that's a
configuration fallback, not an unconfirmed vendor status anymore.

| Integration | Status | Blocked on |
|---|---|---|
| *(none currently)* | — | — |

Calling any stub's methods will throw immediately with a message naming exactly what's
missing — that's the point, not a bug to fix by mocking a response.

**Hellopeter, LinkedIn, and Pay-Lesotho are gone, not stubbed** — all three removed from
Master Plan scope (v1.2, v1.1, and 2026-09-09 respectively). Pay-Lesotho specifically was
dropped once MoPay's integration became fully confirmed and live-verified, including its
commercial terms (see "MoPay: a real integration" below) — a second, unconfirmed
aggregator for the same M-Pesa/EcoCash rails added no value once one was proven. Their
old files under `src/modules/integrations/` now just contain a comment explaining why and
pointing to the replacement (or, for `lesotho-mobile-money.service.ts`, an empty tombstone
— it's actually removed from the real git repository; only this working copy couldn't
delete it directly, see that file's own comment for why); delete them whenever convenient.

### MoPay: a real integration, live-verified against the actual sandbox

Unlike the other integrations above, **MoPay is no longer a `PendingVerificationError`
stub.** Its API is public and documented at mopay.co.ls/docs, and sandbox access is
self-serve — no vendor negotiation, no waiting on approval. This is a status upgrade,
corrected explicitly rather than left inconsistent, the same way Hellopeter's status was
corrected in Master Plan v1.2.

`integrations/payments/mopay.service.ts` is a real client (`createPaymentSession`,
`getSession`) shaped to match MoPay's actual documented flow — which is a **hosted
checkout redirect**, not a "push a charge to this phone number" API: your backend
creates a session, redirects the customer to MoPay's page, they pick M-Pesa/EcoCash/card
themselves, and you verify the result server-side afterward. That's different enough
from the original generic `LesothoMobileMoneyService` interface that this class
deliberately does not implement it — forcing MoPay into that shape would misrepresent
how it actually works. That generic interface (and Pay-Lesotho, the second aggregator it
existed to cover) has since been removed from scope entirely — see this section's own
top note.

**Actually run against the live sandbox, once, with a real API key**: a session was
created and retrieved successfully via the real MoPay API — confirming auth, request
shape, and response parsing all genuinely work, not just that they compile against a
mock. The 6 tests in `mopay.service.test.ts` still mock `fetch` for deterministic,
network-free CI runs; the live call is what actually proved the client works.

**A real finding from that live call, already fixed**: MoPay's actual session-detail
response is far larger than the public docs show, and includes the **raw project API
key** — twice, once directly and once nested under `project.apiKey` — plus the account
owner's name and email under `project.user`. `getSession()` originally returned that raw
object wholesale. It's been rewritten to explicitly pick only the documented, safe fields
off the response, with a regression test (`getSession never forwards MoPay's raw session
object`) asserting the API key and owner info can never leak through. If you write any
other code that calls MoPay's session endpoint directly, don't forward its raw response
anywhere — this is a confirmed API behavior, not a hypothetical one.

**Confirmed directly by the MoPay team** (email reply, 2026-09-09) — the last two
genuinely unconfirmed figures for this integration:

| Payment method | Transaction fee |
|---|---|
| M-Pesa | 2.5% |
| EcoCash | 2.5% |
| Card payments | 3.5% |

Plus a once-off **M500 onboarding fee** when moving to production. **Settlement: 2–3
business days**, depending on the payment method. MoPay also confirmed they'll provide
the actual merchant terms as part of production onboarding, and — since the sandbox
integration below is already proven end-to-end — offered to help activate production
access whenever Mytrima is ready to go live.

**The full payment flow has now been walked end-to-end, live**: created a real sandbox
session, opened its actual `paymentUrl`, selected M-Pesa, entered the documented instant-
success preset number (`52211111`), paid, and was genuinely redirected to `redirectUrl`
with `status=success`. Then — per the docs' own advice not to trust redirect params
alone — independently re-verified via a fresh `getSession()` call: `status: "COMPLETED"`,
`transactionStatus: "success"`, a real `transactionId`, `selectedPaymentMethod: "mpesa"`,
and (confirming the leak fix above holds under a real response, not just the mocked test)
no API key or account info anywhere in it. Every stage of this integration — create,
redirect, pay, verify — is now genuinely proven, not assumed.

### Google Business Profile: OAuth flow proven live, one more access gate to clear

Same status upgrade as MoPay, for the same reason: the account-level Basic API Access
request has been submitted **and approved** by Google (confirmed directly). That closes
both things the old "Needs verification" status flagged as unknown:

- **Quota**: 300 requests/minute by default once approved (0/minute before — a project
  with unapproved access can't usefully call this API at all), plus a separate 10
  edits/minute-per-location cap specific to the Business Information API. Quota increases
  aren't automatic — Google requires demonstrated >50% average utilization first.
- **Field coverage**: confirmed against the real Review resource schema — `reviewId`,
  `reviewer` (`displayName`/`profilePhotoUrl`/`isAnonymous`), `starRating`, `comment`,
  `createTime`, `updateTime`, and any business reply are all present via the API.

`integrations/reputation/google-business.service.ts` is a real client
(`GoogleBusinessProfileService.fetchReviews`) matching the documented
`GET /v4/accounts/{accountId}/locations/{locationId}/reviews` endpoint — including a
detail easy to get wrong without checking the actual schema: **`starRating` is the string
enum `ONE`–`FIVE`, not a number**, normalized to 1–5 here so callers don't need to know
that.

**A real architectural finding, not an implementation detail**: this API has no API-key
or service-account path at all — confirmed from Google's own OAuth docs. Every request
needs an OAuth 2.0 access token obtained through actual user consent (scope
`business.manage`) **from the Google account that manages each business listing**. That
means, unlike MoPay's single platform-wide API key, **Mytrima needs a "Connect your
Google Business Profile" flow per tenant** — no single credential reads every tenant's
reviews. Google issues a refresh token ("never expires unless revoked") on first consent;
that's what should be stored per tenant, not the short-lived access token. This is a real
product requirement to design for, not a footnote: a connect-flow UI and a per-tenant
OAuth callback + refresh-token store need to exist before this client is reachable in
practice — and the OAuth consent screen itself needs an app name, logo, terms-of-service
link, and (this is exactly where `privacy-policy.html` becomes load-bearing again, not
just a Meta App Review requirement) a **live privacy policy URL**.

**The OAuth/account/location plumbing has actually been run live** — a real OAuth Client
ID was created, the consent screen was completed end-to-end via Google's OAuth Playground,
and the resulting access token successfully called the real
`mybusinessaccountmanagement`/`mybusinessbusinessinformation` APIs: a real account and a
real, named business location ("Visual Creation Lesotho") both came back. So the
per-tenant OAuth flow this client depends on is genuinely proven to work, not assumed.

**A second, separate access gate — found only by trying the actual live call, not written
down anywhere obvious**: the Reviews endpoint specifically lives on the older
`mybusiness.googleapis.com` (legacy v4) API, which needs its **own** "Basic API Access"
approval — a 403 `SERVICE_DISABLED` confirmed this live, distinct from the Business
Profile access already granted above. Apply at
[support.google.com/business/contact/api_default](https://support.google.com/business/contact/api_default)
(select "Application for Basic API Access," provide the GCP Project Number). **Eligibility
per Google's own stated requirements: the Business Profile must be verified and active for
60+ days, with a website listed on the profile** — worth confirming the test location
actually meets that bar (its account came back `verificationState: "UNVERIFIED"`) before
submitting and waiting days-to-weeks for a likely rejection.

**What's still NOT exercised**: the actual `fetchReviews()` call, blocked on that second
access gate. The 5 tests still mock `fetch`. Once Basic API Access for
`mybusiness.googleapis.com` is approved, re-run against the real endpoint the same way
MoPay was — that's what would take this the rest of the way to "genuinely proven."

### Facebook & Instagram: a real Meta Graph API client, live-verified end-to-end

Progress since the last pass: registered as a Meta Developer and created the app itself —
**App ID `1593761498813893`** ("Mytrima," Business type), 2026-09-09.
`integrations/social/meta.service.ts` is now a real client
(`MetaGraphSocialService.publishPost`/`fetchEngagementSummary`), upgraded from a
`PendingVerificationError` stub the same way MoPay was — checked directly against Meta's
current Graph API docs (v26.0, 2026-09-09), not memory.

**A real finding from reading the current docs, not assumed**: modern Graph API has no
simple `likes` field on a Page post — Facebook consolidated to multi-type `reactions`
back in 2016, and the current `/post` schema lists no `likes` field at all. This client's
`fetchEngagementSummary()` reports `likes` as `reactions.summary.total_count` (every
reaction type combined) — the closest real equivalent, and what most third-party tools
mean by "likes" today, but documented here rather than silently treated as identical to a
literal thumbs-up count. Also changed from the original stub's signature:
`fetchEngagementSummary` now takes the post id `publishPost()` returns, not a Page id —
engagement is a per-post concept in the Graph API, there's no single documented call for
a Page's aggregate engagement across all its posts without the separate Page Insights API
(its own additional permissions, not requested here).

**What "Standard Access" actually means here, confirmed from the docs**: publishing to a
Page *you* manage yourself works today with just a Page access token generated in Graph
API Explorer — no App Review needed. What Master Plan Section 8 still marks "Needs
verification" is **Advanced Access** specifically: serving *other tenants'* Pages, which
needs Meta App Review (2–4 weeks, requires a screencast of this actually working) and
prior Business Verification (real business documents submitted — not yet started). The
client works identically for both; only whose Page token you have, and how it was
obtained, differs.

**6/6 tests pass against a mocked `fetch`** (deterministic, network-free CI) — publishing
a text-only post, publishing with an image (correctly routes to `/{page-id}/photos`
instead of `/{page-id}/feed`, since `/feed`'s own `object_attachment` field needs an
already-uploaded photo id, not an arbitrary URL), a Graph API error response, and the
engagement-summary parsing including a post that's never been shared (Meta omits the
`shares` field entirely rather than returning `{count: 0}` — defaulted to `0` here so
callers don't need to know that).

**Actually run against the live Graph API, not just written and assumed correct**: a real
Page access token for the real "Mytrima" Facebook Page was generated via Graph API
Explorer, then used to call this exact class's `publishPost()` and
`fetchEngagementSummary()` — `publishPost()` returned a genuine post id
(`1345040488689239_122095109763479138`), and `fetchEngagementSummary()` correctly read
back `{likes:0, comments:0, shares:0}` for that freshly-created post. The test post was
deleted immediately afterward via the same Graph API, confirmed `{"success":true}`.

**A real, non-obvious finding from that live setup**: `pages_manage_posts` and
`pages_read_user_content` refused to appear no matter how the permission checkboxes were
selected in Graph API Explorer — it kept silently substituting unrelated permissions
(`pages_manage_ads`, `pages_messaging`) instead. The actual cause: those two permissions
simply weren't part of the app's own configuration yet. Meta's App Dashboard requires
explicitly adding the **"Manage everything on your Page"** use case (Dashboard → Use
cases → find it → Customize → add `pages_manage_posts` / `pages_read_user_content` there)
before Explorer can grant them at all — even for Standard Access to your own Page. Once
that one-time Dashboard configuration was done, Standard Access worked immediately, no
App Review needed, confirming the model Meta's own permissions reference describes ("Meta
App Review – for apps that need access to data you do not own or manage").

**The App Review blocker itself, then closed for real**: App Review's screencast
requirement for `pages_manage_posts` explicitly requires demonstrating the login +
posting flow "on your app platform" — Graph API Explorer, Meta's own tool, does not
satisfy that. So the real Facebook Login OAuth flow was built
(`social-publishing/meta-oauth.service.ts` + `social-publishing.controller.ts`,
`/social/:tenantId/connect` → Facebook's real `dialog/oauth` → `/social/callback`),
wired into the dashboard (`app.controller.ts`'s "Social Publishing (Facebook)" card), and
then **live-verified end-to-end on 10 Sep 2026 through the running app itself — no Graph
API Explorer anywhere in this trace**:

1. `GET /social/:tenantId/connect` redirected to the real Facebook OAuth dialog; the
   permission grant was clicked for real in a real browser.
2. Facebook redirected back to `/social/callback?code=...`; `MetaOAuthService.handleCallback()`
   exchanged the code for a real user token, resolved the real "Mytrima" Page
   (`1345040488689239`) via `/me/accounts`, and the resulting `SocialConnection` — including
   that Page's own access token — was saved to the real `social_connection` table.
3. `GET /social/:tenantId/connection` read that saved row back: `{"connected":true,
   "pageId":"1345040488689239","pageName":"Mytrima",...}` — confirming the connection
   round-trips through Postgres correctly, and that the endpoint never leaks the raw
   access token into the response.
4. Using nothing but that saved connection, `POST /social/:tenantId/posts` created a real
   post (`1345040488689239_122095429095479138`), `GET .../engagement` read back
   `{likes:0,comments:0,shares:0}`, `PATCH .../posts/:postId` edited it
   (`{"success":true}`), and `DELETE .../posts/:postId` removed it (`{"success":true}`) —
   then a follow-up engagement fetch confirmed Facebook itself now reports the object
   gone, with the resulting `MetaApiError` correctly surfaced as a `502` by
   `DomainErrorFilter` rather than swallowed.

This is the same create → read → edit → delete → confirm-deleted cycle proven by hand via
curl in the first Meta Graph API pass above, now proven again with zero manually-pasted
tokens anywhere in the path — every credential used came from a real user clicking through
a real consent screen.

**Instagram added 2026-09-10** — Master Plan §6's Social Publishing Service was always
"Facebook *and* Instagram," but only Facebook existed until now. Checked directly against
Meta's current Instagram Graph API content-publishing docs, not assumed from the
Facebook-side mechanics above: `MetaGraphSocialService.resolveInstagramAccount()` resolves
a Facebook Page's linked Instagram professional account via `GET /{page-id}?fields=
instagram_business_account` using that same Page's own access token — no separate
Instagram credential exists — and `publishInstagramPost()` implements the real two-step
container-create-then-publish flow (`POST /{ig-id}/media` → `POST /{ig-id}/media_publish`),
since Instagram has no single-call, text-only post the way a Facebook Page does.
`instagram_basic` and `instagram_content_publish` were added to
`MetaOAuthService.REQUIRED_SCOPES`, `SocialConnection` now carries the resolved
`instagramAccountId` (nullable — most Pages won't have one linked, a real and expected
state, not an error), a new migration (`0013_social_connection_instagram.sql`) adds that
column, and the dashboard's Social Publishing card gained its own Instagram post form,
wired to a new `POST /social/:tenantId/instagram-posts` endpoint (`NoInstagramAccountLinkedError`
→ 400 when the connected Page has no Instagram account to post to).

**14/14 new tests pass against a mocked `fetch`** — successful resolution, the "no account
linked" case (Meta simply omits the field, not an error), a Graph API error surfaced
correctly, the two-step publish succeeding, an omitted caption, and both the container-
create and the publish step separately failing.

**NOT YET live-verified against the real Graph API** — the same honest gap Google Business
Profile has: `resolveInstagramAccount()` needs a real Instagram professional account
actually linked to the "Mytrima" Facebook Page to test against, which doesn't exist yet.
Built and tested, not yet proven live, and documented as exactly that rather than
implied otherwise. `db/migrations/0013_social_connection_instagram.sql` (a single nullable
column addition) is likewise build-verified and covered by
`pg-social-connection.store.test.ts`'s gated real-Postgres tests, but was not freshly
re-run against a live database this pass — the local `TEST_DATABASE_URL` credential
wasn't available in this session.

### WhatsApp: from "Assumed" to a real, live-verified send

`integrations/whatsapp/whatsapp.service.ts` is now a real client
(`WhatsAppCloudApiService`), upgraded from `NotYetVerifiedWhatsAppService` the same way
MoPay/Meta Graph API were — checked directly against Meta's current WhatsApp Cloud API
docs (developers.facebook.com, 2026-09-10), not memory. Direct Cloud API access, using the
same Meta Developer app already registered for Facebook/Instagram (WhatsApp is a product
added to that one app, not a separate developer registration) — not a third-party BSP.

`sendTemplateMessage(toE164Phone, templateName, params)` posts to
`/{phone-number-id}/messages` with `type: "template"`, a `language.code` of `en_US`, and —
when `params` is non-empty — a `body` component carrying them as positional text
parameters. `sendFreeformReply` posts a plain `type: "text"` message; per the docs, that's
only allowed within 24 hours of that recipient's last inbound message to this number
("customer service window") — every notification this platform sends is
business-initiated, never a reply, so `notification-worker.service.ts` only ever calls
`sendTemplateMessage`.

**7/7 tests pass against a mocked `fetch`** (deterministic, network-free CI) — the correct
request body and `Bearer` auth header for both a plain template and one with body
parameters, a Graph API error surfaced as `WhatsAppApiError`, and the freeform-text path.

**Actually run against the live Cloud API, not just written and assumed correct**: the
WhatsApp product was added to the existing Meta app via its Dashboard (the same "Use
Cases" flow already used for Facebook Login), which provisioned a real test phone number,
its Phone Number ID, and a temporary access token — no Business Verification needed for
development-mode testing. Sent a real `hello_world` template message (Meta's own
pre-approved sample every WhatsApp number gets automatically) via direct `curl` against
this exact client's request shape: Meta responded `"message_status":"accepted"` with a
genuine `wamid.` message id, and **receipt was independently confirmed on the actual
recipient phone**.

**A real, expected finding from that live pass**: the first send attempt failed with
`(#131030) Recipient phone number not in allowed list` — while a WhatsApp app is in
development mode (pre-Business-Verification), Meta restricts sends to recipient numbers
explicitly added and OTP-verified in the Dashboard's own recipient list. Added the real
test recipient there (a verification code sent to and entered from that phone), then the
identical request succeeded. Documented here as a real API constraint, not treated as a
bug in this client.

**Then proven again through the full real pipeline, not just the raw client**: registered
a real tenant, minted a short-lived bootstrap token (see the MFA-enrollment bug and fix
below), completed real MFA enrollment and a real login through the HTTP API, set the
tenant's real `notificationPhoneE164` via `PATCH /auth/tenants/notification-phone`, then
`POST /nps` with a detractor score — the real `NotificationDeliveryService` enqueued it,
the real `NotificationWorkerService` (a real BullMQ `Worker` against real Memurai/Redis)
picked it up, resolved the tenant's phone, and called this exact `WhatsAppCloudApiService`
— which delivered a second real WhatsApp message, independently confirmed received.

**Still not confirmed**: real production cost (Meta charges per conversation past any free
tier) and template-approval turnaround for a real, business-specific template — neither
guessed at here, same discipline as everywhere else in this project.

### A real, previously-undiscovered bug: fresh owners were locked out of their own accounts

Found by actually driving the WhatsApp pipeline test above through the real HTTP API
rather than calling `AuthService` methods directly (which is all every existing MFA test
had ever done): a freshly self-registered owner (`POST /auth/tenants`) had **no way to
complete MFA enrollment**. `login()` correctly refuses to issue any token before MFA is
enrolled (throwing `MfaEnrollmentRequiredError`) — but `POST /auth/mfa/enroll/start` sits
behind `AccessTokenGuard`, which needs an access token. A brand-new owner was locked out of
their own account by design, not by accident, and this had apparently been true since MFA
enrollment was first built — nothing had ever exercised the real HTTP path end to end.

**Fixed**: `MfaEnrollmentRequiredError` now carries a short-lived (10-minute),
narrowly-scoped `enrollmentToken`, minted by `login()` itself at the moment it detects the
owner needs to enroll. `AuthController.login()` catches this specific error and returns
`{mfaEnrollmentRequired: true, enrollmentToken}` (not a generic 401) instead of letting it
propagate. A new `MfaEnrollmentOrAccessTokenGuard` — used only on the two enroll
endpoints — accepts either this enrollment token or a real access token (so a staff member
who already has one can still optionally self-enroll, exactly as before); nowhere else in
the app accepts the enrollment-token type, and `verifyAccessToken()` still rejects it.

**Live-verified end to end through the real HTTP API, with no manual workaround**:
register → login (gets `mfaEnrollmentRequired` + token) → `POST /auth/mfa/enroll/start`
with that token → `POST /auth/mfa/enroll/confirm` with a real TOTP code → real login again
with the TOTP code → a genuine access token. This is the exact flow Master Plan Addendum
§H's "Resolved" tenant self-service onboarding checklist item claimed was done — it wasn't,
fully, until this fix. The dashboard's Auth card was also updated to handle the
`mfaEnrollmentRequired` response shape rather than assuming every login returns a token
pair immediately.

### PayFast: a real, live-verified merchant-of-record payment client

Master Plan Section 17 required one decision before writing any PayFast/Yoco/Ozow stub:
does Mytrima collect payments on Tenants' behalf (merchant of record), or does each Tenant
hold their own merchant account? **Confirmed 2026-09-10 (business decision): Mytrima
collects on Tenants' behalf.** See Master Plan Addendum v1.4 §C.4 for the full decision
record.

**Why PayFast, not Yoco or Ozow**: checked all three vendors' current documentation
before building anything. PayFast is the only one of the three that publishes a
documented **Split Payments** primitive — instantly routing a percentage or fixed amount
of a payment to a named third-party merchant at the moment of payment — built for exactly
this platform-commerce shape. Neither Yoco nor Ozow document an equivalent; using either
would mean building Mytrima's own disbursement engine on top of a plain single-merchant
gateway.

**A real finding from reading the docs, not assumed**: PayFast's integration model is
*not* a JSON create-session API like MoPay's — there is no server-to-server "create
payment" call at all. It's a redirect flow: construct a set of form fields (merchant
credentials, transaction details, an MD5 signature) and have the customer's own browser
POST them directly to PayFast's hosted payment page. `PayFastService.buildPaymentRequest()`
returns exactly those fields plus the action URL; there's nothing to `await`.

**A real, subtle correctness finding**: PayFast's signature algorithm needs PHP's own
`urlencode()` semantics exactly — uppercase `%XX` hex, a space encoded as `+`, and only
`[A-Za-z0-9_.-]` left unescaped. JavaScript's built-in `encodeURIComponent` is not a
drop-in match: it leaves `!~*'()` unescaped (PHP's `urlencode` does not) and encodes a
space as `%20`, not `+`. Getting this wrong produces a signature PayFast's own server
silently never accepts — exactly the class of bug PayFast's own "Common causes of a
failed integration / signature mismatch" support page exists to explain. Implemented as
`phpUrlEncode()`, a precise byte-level match, not a patched `encodeURIComponent`.

**17/17 tests pass** — `phpUrlEncode`/`buildSignature` checked against an MD5 value
computed independently with Node's own `crypto` module (not copied from PayFast's docs,
whose own example signature isn't tied to published field values), field-order
independence, the `setup` split-payment field correctly excluded from the signature,
and the ITN signature-verification/server-confirmation logic (mocked `fetch`).

**Actually run against the real PayFast sandbox, not just written and assumed
correct** — using PayFast's own publicly-documented, no-signup-required sandbox test
credentials (merchant id `10000100`, published in their own docs for exactly this
purpose): built a real signed payment request and POSTed it to
`https://sandbox.payfast.co.za/eng/process` — PayFast's real server accepted it and
redirected to a genuine hosted checkout page at a real PayFast-issued payment URL,
which rendered back our exact item name ("Mytrima live sandbox test") and amount
("100.00"), confirming the signature and field construction are genuinely correct
against the live gateway, not just internally self-consistent. Separately confirmed the
real ITN server-confirmation endpoint (`/eng/query/validate`) is live and reachable — it
correctly returned `INVALID` for a fabricated transaction id that was never actually
paid, the honest expected answer.

**Real schema and module built around it**: `TenantRecord.payfastMerchantId` (migration
0015) — each Tenant needs their own PayFast merchant account to receive their Split
Payment share; set via `POST /payments/:tenantId/merchant-id`. `PaymentsController`
exposes `POST /payments/:tenantId/checkout` (staff-initiated — a defensible default for
this pilot's scope, not a public self-serve checkout page, which is a real UI decision
for later) and the public `POST /payments/itn` PayFast itself calls server-to-server,
with no access token to present — the one legitimate unauthenticated write in this
module, same category of exception as `POST /auth/tenants`. Every ITN, verified or not,
is recorded in `payfast_itn_log` (RLS-scoped, real jsonb round-trip of the raw payload) —
deliberately **not** an order/invoice/fulfillment table, since no such model exists
anywhere yet in this codebase to attach a payment outcome to; inventing one here would be
guessing at a business process nobody has specified.

**A real bug this build surfaced and fixed**: `PaymentsController` uses
`@UseGuards(AccessTokenGuard)` and injects `TenantService` directly, but `AuthModule`
had never exported either — only their backing tokens. A module that only *imports*
`AuthModule` couldn't resolve them, and Nest's real DI container failed loudly
(`UnknownDependenciesException`) the moment `app.module.test.ts`'s own full-container
test tried to wire everything together for real — exactly the kind of gap that test
exists to catch. Fixed by exporting `AccessTokenGuard`, `TenantService`, and `AuthService`
from `AuthModule`. That alone wasn't quite enough, though — a second real finding: Nest
resolves a guard referenced via `@UseGuards(SomeClass)` through the *consuming* module's
own injector, which (unlike a plain constructor-injected provider such as `TenantService`)
doesn't automatically pick up a same-class export from an imported module. `PaymentsModule`
also needed `AccessTokenGuard` re-declared in its own `providers` array — reusing the same
underlying `AuthService` singleton, not a second, divergent auth system — before the real
DI container would actually resolve it.

**A second, more serious real bug — an ITN's signature verification always failed,
silently**: caught only by actually POSTing a self-signed ITN through the real
`/payments/itn` endpoint and checking the logged result, not by any unit test (every
existing mocked test happened to construct its fixture the same wrong way).
`verifyItnSignature()` originally reused `buildSignature()` — the *outbound* checkout
request's fixed, small field list (`merchant_id`, `amount`, `item_name`, ...). A real ITN
payload uses an entirely different field set (`pf_payment_id`, `payment_status`,
`amount_gross`, ...) that doesn't even overlap on the amount field's name, and per
PayFast's own PHP validation example, an ITN's signature must be recomputed from
*whatever fields actually arrived, in the order they arrived* — not a fixed canonical
list. Fixed with a separate `buildSignatureFromRawFields()` that mirrors PayFast's own
`foreach($pfData as $key => $val)` approach exactly (JS object key order preserves
insertion order the same way PHP's associative arrays do). Live-verified after the fix:
a correctly-signed self-POSTed ITN now logs `signatureValid: true` (was silently `false`
before), and `serverConfirmed: false` correctly reflects that the fabricated transaction
was never actually processed by PayFast.

**Then proven again through the full controller, not just the raw client, live against
the real sandbox**: registered a real tenant through the real HTTP API (also
re-confirming the MFA-lockout fix above with zero manual workaround this time), set its
real `payfastMerchantId` via `POST /payments/:tenantId/merchant-id`, called
`POST /payments/:tenantId/checkout` with a 90% tenant split, and POSTed the exact fields
our own controller returned to PayFast's real sandbox — accepted, redirecting to a
genuine hosted checkout page rendering our exact item name and amount, split payment
included. Then POSTed a correctly-signed ITN to our own `/payments/itn` and confirmed via
`GET /payments/:tenantId/itn-log` that it was logged with `signatureValid: true`.

**Still genuinely open, not guessed at**: a real production PayFast account for Mytrima
itself, Split Payments actually enabled on it, each pilot Tenant's own real merchant id,
and the platform's fee percentage/amount — none of these exist yet. The sandbox proof
above validates the integration's mechanics, not a live production account or a chosen
fee. A security/compliance advisor should also review the merchant-of-record model
before any real (non-sandbox) transaction runs — holding customer funds before splitting
them out, even instantly via PayFast's own feature, is a materially different exposure
than a "each tenant holds their own account" model would have carried; recorded as an
open risk in Master Plan Addendum v1.4 §K.

### Growth-strategy KPIs: Churn Rate and Customer Lifetime Value, from a real cited source

The user supplied a real reference document — "Essential Growth Strategy KPIs" — listing
eight KPIs across four pillars (Financial Growth, Acquisition Efficiency, Retention &
Value, Leading Indicators), each with a stated formula. Same discipline as every other
number in this project (no invented industry-benchmark defaults — Master Plan Addendum
§E's own rule): checked which of the eight this schema can actually compute from real
data before building anything, rather than porting all eight and guessing at the ones
that don't fit.

**Two are now real, computed KPIs, added to `sale.service.ts`:**
- **Churn Rate** — `(Lost Customers during period ÷ Total Customers at start of period) ×
  100`, the doc's own formula applied unchanged. "Start of period" = a named customer with
  a sale before the period; "lost" = zero sales in the period. Slots into the existing
  `SalesKpis`/`KpiBenchmarkService` machinery directly — `churn_rate` is now a real
  benchmarkable KPI, same as the original six.
- **Customer Lifetime Value** — `Average Order Value × Purchase Frequency × Customer
  Lifespan`. The source doc states the formula but not each factor's exact units — a real
  ambiguity in the source itself, resolved with one documented interpretation rather than
  left implicit: Purchase Frequency is annualized (orders per named customer ÷ that
  customer's age in years) precisely so it's dimensionally consistent to multiply by a
  Customer Lifespan also expressed in years (average `last purchase − first purchase`,
  computed only over customers with 2+ purchases — a single-purchase customer has no
  observed span yet, and treating that as 0 would understate this number dishonestly).
  Not period-scoped like every other Sales KPI — "lifetime" is inherently all-time, so
  `GET /sales/:tenantId/lifetime-value` takes no date-range params. Returns `null` — not a
  fabricated 0 — when there isn't enough real data yet (no sales, no named customers, or
  no repeat customer to observe a lifespan from).

**A real bug this surfaced while wiring `churn_rate` in**: `kpi-benchmark-check.service.ts`
had its own hand-duplicated copy of the KPI-name-to-field mapping already defined once in
`kpi-benchmark.service.ts` — and that second copy had already silently drifted the moment
this change added a field the duplicate didn't know about. Fixed by exporting
`KPI_TO_SALES_FIELD` from its one real definition and having the checker reuse it, rather
than patching the second copy and leaving the duplication itself in place for the next KPI
to drift on again.

**The other six KPIs in the source document are deliberately NOT built**, the same
"don't guess at scope" discipline as everywhere else in this project — none of them fit
data this schema tracks today:

| KPI | Why it's not built |
|---|---|
| Customer Acquisition Cost (CAC) | Nothing tracks marketing/sales spend anywhere in this system |
| LTV : CAC Ratio | Blocked on CAC |
| Net Revenue Retention (NRR) | Framed for subscription MRR; the Sales module is discrete POS transactions (Addendum §E), not recurring revenue — porting this would mean reinterpreting it, not a straight implementation |
| Conversion Rate by Funnel Stage | No lead/pipeline-stage entity exists — only an already-completed `sale_transaction`, nothing pre-sale |
| Qualified Lead Velocity Rate | Same gap — no "lead"/MQL concept exists at all |
| MRR / ARR | Same recurring-revenue mismatch as NRR |

Building any of these would mean adding real new product scope (a Lead/MQL entity,
marketing-spend tracking, a subscription-revenue concept) — exactly the kind of decision
Master Plan Addendum §B says must be named and signed off, not slid in as a side effect of
"porting a KPI list." The source document's own cited benchmark worth keeping in view once
CAC exists: **LTV : CAC ≥ 3:1** — "less than 3:1 means you are overspending" — a real,
sourced number, not fabricated, ready to wire in the moment CAC tracking is actually built.

### Deep-analysis recommendations: closing the diagnose-but-never-prescribe gap

A deep review of the platform against its own stated mission ("growth consultancy," not
just a CRM/marketing tool suite) surfaced five real gaps. All five are now built, tested,
and live-verified end to end — not just designed.

**1. The Growth Audit recommendation engine — the centerpiece.** Until now, Growth Audit
computed a score/band and fired one notification on a Critical band; it never said what to
do about it, and there was no way to see if a tenant improved. `recommendation.service.ts`
closes that loop:
- **Ranks sections by weighted opportunity**, not raw grade — `(100 - sectionPct) x
  weightPct / 100`. A 20%-weighted section at 50% outranks a 10%-weighted section at 40%,
  even though the second one's raw percentage looks worse — the bigger real lever, not
  just the worse grade. Same "no fabricated benchmark" discipline as everywhere else: every
  target is this tenant's own instrument-defined rubric, never an invented industry figure.
- **Maps weak questions to real, verifiable in-app actions** — a deliberately incomplete
  table (`QUESTION_ACTIONS`, 10 of 40 questions): Sections C (Business Strategy) and E
  (Brand & Positioning) have NO mapping at all, because nothing in this schema can verify a
  written business plan, a SWOT, brand consistency, or competitor pricing — an honest,
  disclosed gap (`topSectionHasNoAppSignal`), not a weak or invented proxy forced in.
- **Catches self-report vs. real-data divergence** — if a tenant answers a question as
  weak but a real signal (a KPI benchmark, a recent rating, a recent post) shows they're
  already doing it, that's surfaced as a `divergence`, not silently recommended again — a
  distinctive insight only possible because this platform already holds real activity
  data, not just survey answers.
- **Real recommendation-to-action tracking** (`recommendation` table, migration 0018) — the
  actual KPI that proves this loop works, not just "a message was sent." Lazy detection on
  every fetch (re-checks past undetected recommendations against current signals), not a
  separate scheduled job — a disclosed tradeoff, not a proactive poll.
- **A real gap this closed along the way**: nothing persisted Mytrima's own record of "did
  this tenant post to Facebook/Instagram" — `MetaGraphSocialService` calls the real Graph
  API live but never logged history. New `social_post_log` (migration 0017), wired into
  `SocialPublishingController`'s real post-creation paths, now gives Section F a real
  signal instead of self-report only.
- **Live-verified, not just unit-tested**: submitted a real Growth Audit with two
  deliberately weak answers (conversion-rate tracking, posting schedule) through the real
  running server — the engine correctly ranked sections and recommended exactly those two
  real actions. Then set a real KPI benchmark through the real Sales API and re-fetched:
  the matching recommendation disappeared, moved to `divergences`, and
  `actionToActionRate` went from 0 to 50 — the loop closing for real, watched happen over
  HTTP, not asserted in a test.
- **A real bug caught before it shipped**: `markDetected()`'s first version updated a row
  by id with no tenant context set — under this table's own RLS policy (tenant_id compared
  against `current_setting('app.current_tenant_id', true)`, null outside a tenant context),
  that update would have silently affected zero rows. Fixed by threading `tenantId` through
  and running the update inside the correct tenant context, caught by review before any
  real-database test ever ran, not after a real detection silently failed.

**2. Onboarding checklist** (`onboarding.service.ts`) — a brand-new tenant used to land
after register -> MFA enroll -> login with nothing guiding them on what to do next. A
computed (not stored — every signal is already real data elsewhere, storing a separate flag
would just be a second, driftable source of truth) `GET /onboarding/:tenantId` checks five
real signals: a Growth Audit done, a notification phone set, a social connection, a
PayFast merchant id, a first customer. Live-verified: a fresh tenant reads 0% complete;
after real signals were added one at a time through the real API in the design/build pass,
completion tracked correctly to 100%.

**3. Operator pilot summary** (`admin/pilot-summary.service.ts`) — nothing let the platform
operator see which of the 5-10 pilot tenants are active or stalled, a real risk for a
grant-funded pilot needing to report impact. `GET /admin/pilot-summary` aggregates every
real tenant's latest Growth Audit score/band, NPS, and onboarding completion —
deliberately cross-tenant, unlike every other endpoint in this project. Gated by a single
shared `ADMIN_API_KEY` header (fails closed if unset, same pattern as `TENANT_SIGNUP_CODE`)
rather than bending the tenant-scoped RBAC system, whose entire design is "no cross-tenant
role exists" (rbac.ts's own words) — bending that for one operator would be a bigger,
riskier change than this pilot needs. Live-verified: rejected with 403 with no/wrong key,
returned a real (empty, since no `DATABASE_URL` in that test run — a disclosed limitation,
not silently wrong data) summary with the correct key.

**4. Idempotent PayFast ITN handling** — PayFast's own docs state it retries a notify_url
delivery that didn't return HTTP 200 "immediately, then after 10 minutes and then at
exponentially longer intervals." Every retry used to insert a new `payfast_itn_log` row for
the same real payment — harmless as a log today, but a real bug the moment anything acts on
an ITN. Fixed with a real unique constraint (`(tenant_id, pf_payment_id)`, migration 0016)
and `on conflict do nothing` in the real store, mirrored in the in-memory one. Live-verified:
POSTed the identical signed ITN twice through the real running server — exactly one entry
was logged, not two.

**5. Rate limiting** — nothing anywhere limited `/auth/login`, `/payments/itn`, or
`/social/callback`, all either auth-sensitive or deliberately unauthenticated by design. A
real gap given real money now flows through PayFast. Hand-rolled (`RateLimitGuard`), not a
new dependency (`@nestjs/throttler`) — same dependency-count discipline package.json's own
notes already state for JWT/TOTP/password hashing. A per-route `@RateLimit({max, windowMs})`
decorator + a `Reflector`-based guard, disclosed as single-process in-memory state (fine at
this pilot's scale, same "right-size before scale" reasoning as the in-process BullMQ
worker). Live-verified: hammered `/auth/login` 11 times through the real running server —
the first 10 returned real 401s (wrong credentials), the 11th returned a real 429.

Two real DI-wiring bugs surfaced while building these, both caught by `app.module.test.ts`'s
own full-container test before ever reaching a browser: `CustomerModule`, `GrowthAuditModule`,
and `SocialPublishingModule` had never exported their own services for another module to
inject (same class of gap already found once on `AuthModule` — see the MFA-lockout fix
above), and `AccessTokenGuard` specifically needed re-declaring as a local provider in each
consuming module, since Nest resolves a class-referenced `@UseGuards()` through the
*consuming* module's own injector, which doesn't automatically pick up a same-class export
the way a plain constructor-injected provider does. `RateLimitGuard` and `AdminApiKeyGuard`
were designed to avoid this entirely — neither has a cross-module dependency, only
`Reflector` (a core Nest provider, resolvable everywhere) or nothing at all.

### The Business Snapshot report — one place that answers "how is my business doing"

Prompted directly by a real reference document the user supplied: a sample multi-location
salon-chain quarterly performance summary (Executive Summary → per-location Performance
Snapshot → chain-wide Experience Metrics → numbered Findings → a Prioritized Action Plan
split into quick wins vs. strategic initiatives → a Methodology & Caveats section). That
document is the real target this report was built toward — not just a design inspiration,
a structural spec.

**Two new, real building blocks, sourced or derived, not fabricated:**
- `common/period.ts` — `previousPeriod()` computes the immediately preceding period of the
  *same length*, no gap, no overlap, so any KPI can be compared against this tenant's own
  recent past. `computeDelta()` reports `null` (not a guessed 0 or `Infinity`) when there's
  no previous value, or when the previous value is exactly zero.
- **New-customer repeat rate** (`SaleService.computeRepeatRate()`) — a real, distinct KPI
  the reference document treated as the single biggest revenue lever: of customers whose
  *first-ever* purchase falls in the period, what % came back for a second one (any time
  after, no fixed window — none is cited by any source). Distinct from Churn Rate, which is
  about existing customers lapsing, not new ones never returning at all. Fully computable
  from existing `sale_transaction` data, no new schema.

**`GET /reports/:tenantId/snapshot`** (`snapshot.service.ts`) pulls these together with
Sales KPIs, NPS, Ratings, the latest Growth Audit score, and the real recommendation engine
into one report:
- **Executive Summary** — a real sentence generated from the real sales delta, not prose.
- **Performance** — every core Sales KPI plus Repeat Rate, each with a real current-vs-
  previous-period delta.
- **Findings** — a small, deterministic rule set (currently: meaningful churn-rate change,
  meaningful repeat-rate change with a real, *derivable* dollar-impact estimate — the gap in
  returning customers × this tenant's own real average order value, exactly the reference
  document's own "$5,000+ in monthly revenue" sizing logic applied to real numbers — and
  meaningful NPS change). A "meaningful change" threshold (5 points) is a disclosed default,
  not a researched optimum, same as every other undecided-but-necessary number in this
  project.
- **Action Plan** — reuses the real recommendation engine's output directly, so the
  Snapshot and `/growth-audit/:tenantId/recommendations` never disagree with each other.
- **Methodology** — a real, honest disclosure section generated every time, stating plainly
  what the reference document's own version stated for its data: comparisons are
  self-referential (this tenant's own prior period, not an external benchmark this project
  has no citable source for), no per-location breakdown exists, revenue figures are gross,
  not margin.

**A deliberate, disclosed scope limit, not an oversight**: unlike the reference document's
own per-salon table, this report has **no location/branch dimension** — `sale_transaction`
has no location field at all, so every number here is tenant-wide even for a business that
operates more than one site. Adding one is a real product-scope decision (a new entity, a
new column on every Sales table) that hasn't been confirmed as needed by any real pilot
tenant — not guessed at here, same discipline as the merchant-of-record decision before
PayFast was built.

**Live-verified end to end, not just unit-tested**: recorded two real sales through the
real running server — one ~45 days ago, one ~10 days ago — then fetched the real Snapshot.
It correctly computed a genuine period-over-period sales delta (200 vs. 100, +100%),
correctly flagged the earlier customer as churned (100% churn — the only start-of-period
customer, and they never returned) and the newer one as not-yet-repeat (0% repeat rate,
both periods), and correctly surfaced the exact real recommendation-engine action for a
deliberately weak Growth Audit answer submitted in the same test — every number checked by
hand against the real request/response, not asserted only in a test.

**Total units sold, added 2026-09-10** — `SalesKpis.totalUnits` (sum of every line item's
quantity across the period) was already computed internally for `unitsPerTransaction` but
never exposed; now it is, on both `computeKpis()` and the Snapshot's own `performance`
block, each with a real period-over-period delta like every other KPI here.

**Real Meta (Facebook/Instagram) account metrics, added 2026-09-10** — the tenant asked for
the report to include the actual numbers a business owner thinks of as "how is my page
doing": likes, comments, shares, followers, impressions, views, and messages. Landed as
`socialMetrics` on the Snapshot, backed by a new `SocialMetricsService`
(`social-publishing/social-metrics.service.ts`) and five new `MetaGraphSocialService`
methods (`meta.service.ts`) — checked directly against Meta's current docs (Graph API
v26.0 and the Instagram Platform Graph API reference, both fetched 2026-09-10), not memory,
which surfaced three real findings before a line of code was written:
1. Instagram's `impressions` metric was fully removed from **every** API version on 21 Apr
   2025 — there is no way to request it at all any more, on any client, not a permission
   gap. `views` is Meta's own documented replacement and the only one requested.
2. The Conversation node's own documented fields (`id`, `messages`, `participants`,
   `updated_time`) have no message-count aggregate, unlike `reactions`/`comments`'
   `.summary(true)` trick already used by `fetchEngagementSummary()`. So "messages" here
   genuinely means **conversation threads updated in the period**, not an individual-message
   count — documented as a deliberate interpretation, not a shortcut hidden from the report.
3. `page_impressions_unique` and the whole `post_impressions*` family are marked deprecated
   above API v25 in Meta's own current reference; the base `page_impressions` and
   `page_views_total` are not, so those two (not the "unique" variants) are what's requested.

Three new OAuth scopes (`read_insights`, `pages_messaging`, `instagram_manage_insights`)
were added to `MetaOAuthService.REQUIRED_SCOPES` for this. Followers needs no new scope at
all — `fetchPageFollowerCount`/`fetchInstagramFollowerCount` are plain node fields under
permissions already granted.

Every field in `socialMetrics` can fail independently — a missing permission or a deleted
post shows up as `null`/a partial count with a real reason string in `unavailable`, never a
silently fabricated number (same "disclose don't fabricate" discipline as everywhere else in
this report). **9 new tests pass** (8 on the new Graph API methods against a mocked
`fetch`, and a real `SnapshotService` integration test proving the full aggregation —
followers, summed daily insights, summed per-post engagement across two real logged posts,
and a real `pages_messaging`-not-granted failure surfacing by name in `unavailable` — against
genuine service instances with only `fetch` mocked), plus the existing OAuth-scope test
updated for the three new scopes. *(Correction 2026-09-10: this section originally said "17
new tests" — re-counted directly from the commit's own diff while adding the Booking module
below and found that overstated; 9 is the real, `git show`-verified number.)*

**Live-verified for the one real, honest state this session could actually reach**: the
real demo tenant built for this report has never connected a Facebook Page, and the live
running server correctly returned `{"connected": false, "facebook": null, "instagram":
null}` — not a fabricated zero for every metric, the same honest-empty-state discipline as
the admin pilot summary. **NOT YET live-verified against the real Graph API itself** — same
category of gap as Instagram publishing above, for a different reason: this pass had no
valid Page access token in hand (nothing from the earlier OAuth proof was persisted to a
file, by design — see this repo's own credential-handling rule), and a live attempt to
generate a fresh one through Graph API Explorer against the real "Mytrima" app hit a real
environment blocker: the browser window was reported at 0×0 (`Cannot take screenshot with 0
width`), so the permission dropdown and consent flow couldn't be driven reliably. Once that
browser is in a normal, visible state, the remaining step is exactly the one
`pages_manage_posts` needed before: add "read_insights"/"pages_messaging"'s matching use
case in the App Dashboard if Explorer doesn't offer them directly, generate a fresh Page
token, and re-run this same code against the real Page (`1345040488689239`) the way
`publishPost()`/`fetchEngagementSummary()` already were.

### Booking module — customers book a service directly

Requested by the tenant on 2026-09-10: let a customer book a `service` catalog item for a
specific time, without a staff member manually logging it after the fact. New
`booking/` module, plus a small additive change to Catalog (`CatalogItem.durationMinutes`,
nullable, meaningful only for `service` items — a `db/migrations/0019` column addition).

**`POST /bookings/:tenantId`** is deliberately unauthenticated, same reasoning as
`RatingController.submit()`/`NpsController.submit()`: a customer is not a Mytrima account
holder anywhere in this system, so there is nothing to authenticate. It does still require a
real, already-created `Customer` record (`CustomerService`) rather than accepting loose
contact fields — reusing the existing Customer module instead of inventing a second,
parallel "who is this" mechanism.

**Real validation, not just a row insert:**
- The catalog item must exist, be `isActive`, and be a `service` — booking a `product` is
  rejected with a clear `InvalidBookingError`.
- Duration is the given `durationMinutes`, or the catalog item's own default if it has one —
  if neither exists, the request is rejected rather than silently guessing 60 minutes (same
  "no fabricated default" discipline as the rest of this platform).
- `scheduledAt` must be in the future.
- **Overlap detection**: a request whose `[scheduledAt, scheduledAt + duration)` window
  intersects an existing `requested` or `confirmed` booking for the same tenant is rejected
  with `BookingConflictError`, naming the conflicting booking's id and time. This is a
  single shared tenant-wide schedule, not a per-staff calendar — nothing in this schema
  tracks which staff member serves a customer (the same simplification Sales already makes,
  and the same "no location dimension" limit the Business Snapshot report discloses) — a
  real, deliberate scope limit, not an oversight. A cancelled booking correctly frees its
  slot for a new request.

**A real, explicit status lifecycle**, not a bare boolean: `requested → confirmed →
completed`, or `→ cancelled` (from `requested` or `confirmed`), or `→ no_show` (only from
`confirmed`, matching a real front-desk workflow — staff must have already accepted the
appointment before it can be marked missed). Any other transition throws
`InvalidBookingStatusTransitionError` rather than silently succeeding.

**Real notification wiring, not a new isolated concept**: reuses the existing
automation.service.ts / NotificationDeliveryService pattern (`notificationsForNewBookingRequest`,
enqueued from the controller right after a successful request) — unconditional, unlike every
other trigger in that file, since every new booking request needs a real human confirm/decline
decision before its time arrives, not just the subset crossing some threshold.

**Postgres**: `db/migrations/0020_booking.sql` — real foreign keys to `tenant`, `customer`,
and `catalog_item`, RLS enabled with the same tenant-isolation policy as every other table.
Deliberately no `EXCLUDE USING gist` range-overlap constraint at the DB layer (that needs the
`btree_gist` extension enabled, a real infra step not yet confirmed available on the pilot's
actual Postgres instance) — overlap is checked in the application layer instead, a portable
choice disclosed here rather than silently assumed equivalent to a DB constraint.

**21 new tests** (19 pass: 16 on `BookingService` — the full lifecycle, tenant-scoped
conflict detection, a back-to-back non-overlapping booking correctly allowed, a cancelled
slot freeing up again — plus 3 on `CatalogService`'s new `durationMinutes` field; 2 more are
a real `PgBookingStore` integration test gated behind `TEST_DATABASE_URL` like every other
real Postgres test here, currently skipped for the same reason the rest of this pass's
Postgres tests are: no working local database credential this session). Full suite: 387
passed, 75 skipped, verified by a direct fresh run, not assumed from an earlier commit's
own count.

**Live-verified end to end against a real running server, not just unit-tested**: created a
real tenant, a real `service` catalog item with a 60-minute duration, and a real customer,
then through the actual HTTP API — no shortcuts:
1. Requested a real booking — created in `requested` status, duration correctly defaulted
   from the catalog item.
2. Requested a second booking 30 minutes into the first one's slot — correctly rejected with
   a real `409 BookingConflictError` naming the actual conflicting booking.
3. Tried to `complete` the still-`requested` booking — correctly rejected (`409
   InvalidBookingStatusTransitionError`); `confirm`ed it, then `complete`d it successfully;
   tried to `cancel` the now-`completed` booking — correctly rejected.
4. Booked a second real slot, then requested the identical time again — correctly rejected
   as a conflict; `cancel`led the second booking; requested that exact same time a third
   time — correctly succeeded, proving a cancelled booking really frees its slot.
5. Tried to book a `product` catalog item — correctly rejected with a real
   `InvalidBookingError` naming the item.

Every response matched its corresponding unit test's expectation exactly, with real UUIDs
and real timestamps, not fixture data.

### Support ticket module — a tenant's own way to report a problem with Mytrima itself

Requested by the tenant on 2026-09-10 ("do we have a way for a tenant to log a ticket if
Mytrima has a problem") — checked first and confirmed a real gap: nothing anywhere in this
codebase or the Master Plan let a tenant report an issue with the platform itself. Given the
choice between a full ticket system, a lightweight contact-form, or just documenting a
support channel, the tenant chose the full system.

New `support/` module, split across two distinct actor populations, each with its own
controller and guard — deliberately not bent into the existing tenant-scoped RBAC system
(`rbac.ts`), same reasoning as `pilot-summary.service.ts`'s own comment on why a genuinely
cross-tenant operator view needs its own gate:

- **The tenant** (`SupportTicketController`, `AccessTokenGuard`): any authenticated staff
  member can file a ticket (`POST /support-tickets`), list or view their own tenant's
  tickets, and reopen one that was resolved but didn't actually fix the problem
  (`POST /support-tickets/:id/reopen`). Every route derives `tenantId`/`createdByUserId` from
  the actor's own verified access token — never from the request body or a URL param, the
  same fix already applied to `PaymentsController`/the notification-phone endpoint — so a
  tenant can only ever see or act on its own tickets, with no way to even ask about another
  tenant's.
- **Mytrima's own operator** (new endpoints on the existing `AdminController`,
  `AdminApiKeyGuard`): `GET /admin/support-tickets` lists every tenant's tickets in one place
  (real cross-tenant aggregation, same "enumerate the un-RLS'd `tenant` table, then reuse the
  real per-tenant service" pattern `PilotSummaryService` already established — there's no
  Postgres role in this deployment that bypasses RLS, so this is the real, working way to
  build a cross-tenant view without one), plus `.../in-progress` and `.../resolve` to move a
  ticket through its lifecycle.

**A real, explicit status lifecycle**, not a bare boolean: `open → in_progress → resolved`
(resolving directly from `open` is also allowed — a trivial issue doesn't need to sit in
`in_progress` first), or `resolved → open` (reopen). `resolve()` **requires** a real,
non-empty `resolutionNotes` — "resolved" with no explanation of what was actually done isn't
a resolution a tenant can trust or act on, the same "disclose, don't silently succeed"
discipline as everywhere else in this platform. A reopened ticket keeps its prior
resolution notes rather than clearing them, so it still shows what was already tried.

**Deliberately NOT built**, same "no invented capabilities" discipline as every other module
here: no threaded comments/replies between tenant and operator (a ticket is a single
subject/description/resolution, not a conversation — a real, disclosed scope limit, not an
oversight), no file attachments, no SLA timers, and no automatic notification to Mytrima's
own operator when a new ticket is filed (the existing `NotificationDeliveryService`/
`notification-worker.service.ts` pipeline is built to resolve and message a *tenant's*
WhatsApp number, not an internal ops recipient — inventing a second, disconnected delivery
path for a recipient category that doesn't exist yet in this schema was judged worse than
leaving `GET /admin/support-tickets` as the real, working way the operator checks the
queue today).

`db/migrations/0021_support_ticket.sql` — real foreign keys to `tenant` and `app_user`
(recording which of the tenant's own staff filed each ticket), RLS enabled with the same
tenant-isolation policy as every other table.

**18 new tests, directly `grep -c`-counted against each file rather than estimated** (15
pass: 14 on `SupportTicketService`'s full lifecycle, tenant-scoping, and two real-bug
regression tests below, 1 on `SupportTicketAdminService`'s honest empty-list fallback with no
Postgres pool configured; `app.module.test.ts`'s existing DI-assertion test was also extended
for the three new providers, not counted again here since it's one existing test, not a new
one). 3 more are real Postgres integration tests (`PgSupportTicketStore` ×2,
`SupportTicketAdminService` ×1) gated behind `TEST_DATABASE_URL`, currently skipped for the
same reason the rest of this session's Postgres tests are.

**A real bug found live-testing this, not caught by the unit tests alone**: calling
`POST /admin/support-tickets/:tenantId/:ticketId/resolve` with no `resolutionNotes` in the
body (a real, easy-to-make client mistake) returned a raw `500 TypeError: Cannot read
properties of undefined (reading 'trim')` instead of the intended `400
InvalidSupportTicketError` — `resolve()`'s `!resolutionNotes.trim()` check never
short-circuited before calling `.trim()` on a genuinely `undefined` value, since Nest doesn't
coerce or validate a request body against a method's TypeScript parameter types at runtime.
The unit tests only ever passed an empty string (`"  "`), never an actually-omitted field, so
they never exercised this path. Fixed by checking truthiness first
(`!resolutionNotes || !resolutionNotes.trim()`), applied to `create()`'s `subject`/
`description` checks too since they share the exact same shape, and both are now covered by
regression tests that pass `undefined as unknown as string` explicitly rather than an empty
string, so this class of bug can't silently reappear.

**Live-verified end to end against a real running server**: two real tenants each filed a
real ticket through `/support-tickets`; tenant A could not view or act on tenant B's ticket
id (a real `404`, not a leak); reopening a still-`open` ticket was correctly rejected
(`409`); the operator resolved tenant A's ticket without a resolution note and hit the exact
500 above — confirming the bug live before fixing it — then, after the fix and a clean
rebuild, the same call correctly returned `400`; marked `in-progress` → `resolve`d with a
real note succeeded; and the tenant reopened it, with the prior resolution note preserved as
history. Also confirmed: a missing/wrong `ADMIN_API_KEY` is rejected before reaching any
tenant's data, and (the same honest-empty-state discipline as `PilotSummaryService`)
`GET /admin/support-tickets` correctly returns `[]` rather than a fabricated cross-tenant
list, since this session has no real Postgres pool to enumerate tenants from.

### Staff module — managing the accounts rbac.ts's roles already applied to

Requested directly by the tenant ("do we have a staff module and access control module for
staff"), immediately after the Platform Readiness Assessment flagged the exact same gap in
passing. Checked first: `rbac.ts` already **is** the real access-control model (Owner/Staff/
Read-only, tenant-scoped, 7/7 tests, live-verified) — what didn't exist was any way to
*manage* the accounts that model governs, beyond the one-way `POST /auth/register` invite.
Asked the tenant which parts to build; the answer was all of them: list/view staff, change
role, deactivate/reactivate, and self-service profile + password change.

Lives inside the existing `auth` module (`staff.controller.ts`, new methods on `AuthService`)
rather than a new one — it operates on the exact same `AuthUserStore`/`app_user` table, so
there's no second store, and `AccessTokenGuard` is already a local provider there, so no
cross-module guard-redeclaration is needed (the gap `PaymentsModule` hit before).

**Two actor shapes, same split as Booking/Support Tickets:**
- **Self-service** (`GET /staff/me`, `POST /staff/me/change-password`) — any authenticated
  user, acts on their own account only. `changeOwnPassword` is a real password change (needs
  the current password, so it needs an active session) — explicitly **not** a forgot-
  password-via-email flow, which needs email-sending infrastructure this platform doesn't
  have; disclosed here rather than silently only building the easier half and implying more.
- **Owner-managing-others** (`GET /staff`, `PATCH /staff/:userId/role`,
  `POST /staff/:userId/deactivate` / `.../reactivate`) — gated by `user:manage`, the exact
  permission `POST /auth/register` already uses to invite someone in the first place.

**A real invariant, not just a nice-to-have**: a tenant can never end up with zero active
owners. Demoting the tenant's last owner away from `"owner"`, or deactivating them, is
rejected with `CannotRemoveLastOwnerError` — checked by re-enumerating the tenant's real
`app_user` rows each time, excluding the account being changed, so a deactivated owner never
silently counts as "another" owner still available.

**Deactivation's real, honest effect — no bulk session-revocation infrastructure invented
for it**: `login()` rejects a deactivated account immediately; `refresh()` rejects the very
next attempt to use an existing refresh token, since it already looks the user up by id on
every call. What this does **not** do: revoke an already-issued, still-unexpired *access*
token — there is no revocation list for those anywhere in this system, for any account, not
just a deactivated one (stateless JWTs, short-lived by design). Documented as a real,
pre-existing architectural limitation this feature doesn't newly introduce, not silently
glossed over.

`db/migrations/0022_app_user_active.sql` — one column, `is_active boolean not null default
true`, so every account that existed before this shipped stays exactly as usable as it
already was. `created_at` (a real column since migration 0001, never mapped into
`AuthUserRecord` until now) is exposed too, for a real "member since" on the staff list —
closing a small, harmless, pre-existing dead-column gap along the way.

**18 new tests** (16 pass: 15 on `AuthService`'s new methods plus the last-owner invariant
in both directions, 1 fixing a pre-existing shape-assertion test that correctly needed
updating once `register()`'s public record gained two real fields; 2 more are real Postgres
integration tests gated behind `TEST_DATABASE_URL`, currently skipped for the same reason
the rest of this session's Postgres tests are — one of which deliberately creates its own
single-owner tenant rather than reusing the file's shared one, since the shared tenant
already has other owners registered by earlier tests in the same file). Full suite: 418
passed, 80 skipped.

**Live-verified end to end against a real running server**: an owner invited a real staff
member, listed both accounts (no `passwordHash` ever in the response), changed the new
account's role to `read_only`; a `read_only` account trying to act on the owner's own account
was correctly rejected (`403`, lacks `user:manage`); an invalid role string was rejected
(`400`); the owner deactivating themselves as the tenant's only owner was correctly rejected
(`409 CannotRemoveLastOwnerError`); the owner then deactivated the staff account, whose next
real login attempt was correctly rejected (`401 AccountDeactivatedError`); reactivating it
let that same account log in again immediately; and the staff member's own self-service
password change, then a follow-up attempt with the wrong current password, both behaved
exactly as the unit tests expect.

### Closing the Platform Readiness Assessment's findings — 2026-09-11

The tenant asked for every finding in the Platform Readiness Assessment (see the published
artifact) to actually get fixed, not just documented. This is that pass.

**1. Auth guards on all 13 previously-open controllers (the assessment's Blocker
finding).** `sales`, `catalog`, `customers`, `deals`, `growth-audit`, `nps` (its
`aggregate()` only — `submit()` stays public, see below), `recommendation`, `onboarding`,
`petty-cash` (both `VendorController` and `PettyCashController`), `reports/snapshot`,
`reputation/rating` (its `moderate()`/`aggregate()` — `submit()` stays public), and
`compliance/consent` are now all behind `AccessTokenGuard` plus a real `rbac.ts` permission
check. `social-publishing`'s remaining unguarded routes (connection status, posting,
editing, deleting, engagement, Instagram posting) are now gated too — only `/connect` and
`/callback` stay public, since those are the real OAuth redirect targets a browser hits with
no Mytrima token to present. Nine new permissions were added to `rbac.ts`
(`sales:view/manage`, `catalog:view/manage`, `customers:view/manage`, `deals:manage`,
`petty_cash:manage`, `booking:view/manage`, `onboarding:view`, `reports:view`,
`social:manage`), split into view/manage where read_only meaningfully differs (sales,
catalog, customers, booking) and combined where it doesn't yet (deals, petty cash — no
established read_only use case for either). `RatingController`'s own `rating:moderate`/
`rating:view` permissions had existed in `rbac.ts` since this project's very first pass but
were never actually checked by any caller until now — the same "permission defined,
unit-tested, never invoked" pattern this codebase has hit before.

**A real, deliberate exception, not an oversight**: `BookingController.request()`,
`RatingController.submit()`, and `NpsController.submit()` stay unauthenticated — a customer
booking an appointment, leaving a rating, or answering an NPS survey is not a Mytrima
account holder anywhere in this system. Several bodies also stopped trusting a bare
`tenantId` in the request body/param once gated — `CustomerController.create()`,
`RatingController.moderate()`, and `ConsentController`'s whole surface now derive `tenantId`
from the actor's own verified token, the same fix already applied to
`PaymentsController`/the notification-phone endpoint.

**2. CORS**, gated by a new `CORS_ORIGIN` env var (comma-separated origins) —
`main.ts`/`common/cors.ts`. Same "config-gated, fails closed if unset" pattern as
`ADMIN_API_KEY`/`TENANT_SIGNUP_CODE`: cross-origin access stays off until a real frontend's
origin is actually known and set, not opened to any origin as a guessed default.

**3. A global `ValidationPipe`** (real `class-validator`/`class-transformer` dependencies,
not hand-rolled) — closes the exact bug class already found once live in the Support Ticket
module. **A real, disclosed partial fix**: the pipe only validates request bodies that are
actual `class`es with decorators; a plain TypeScript `interface` (still most DTOs in this
app) carries no runtime metadata for it to check at all. Converted to real validated
classes so far: `RequestBookingBody`, `SubmitRatingBody`, `SubmitNpsBody` (the three bodies
a stranger on the internet can send directly), `CreateSupportTicketBody` and
`ResolveSupportTicketBody` (the exact DTO whose gap caused the real bug). Every other DTO in
this app still relies on its own service-layer checks only — not silently implied covered by
adding this pipe. A real finding writing the tests for this: `class-validator`'s
`@IsNotEmpty()` only rejects the literal empty string, not a whitespace-only one — a
converted DTO still needs its service's own `.trim()` check for that, and this is documented
in the test suite rather than papered over.

**4. Rate limiting extended** to the four write endpoints the assessment named as exposed:
`BookingController.request()`, `RatingController.submit()`, `NpsController.submit()` (20/min
per client IP — unauthenticated by design, so anyone/any bot could otherwise reach them) and
`SupportTicketController.create()` (20/min — authenticated, but named explicitly in the
assessment, so it gets the same defense against an accidental client bug or a compromised
account).

**5. Real pagination**, added as a genuine, tested, live-verified example on the one endpoint
the assessment named first — `GET /sales/:tenantId` (`?limit=`/`?offset=`, defaults 50, hard
capped at 200 regardless of what a caller requests — `common/pagination.ts`). A new
`SaleStore.findPageForTenant()` pushes the actual `LIMIT`/`OFFSET` down to Postgres (a real
query, not "fetch everything and slice in memory") and returns a real `total` count
alongside the page. **A real, disclosed remaining gap**: the same mechanical pattern still
needs applying to the other list endpoints the assessment also named (bookings, tickets,
catalog, customers, ratings) — not done in this pass, not silently implied finished by this
one proven example.

**6. The CI RLS negative test's staleness**, closed two ways: `ci.yml`'s "Apply migrations"
step now globs every real migration file in order instead of a hardcoded `0001`/`0002` list
(so it can't go stale again the next time a migration is added, and — a real gap this alone
closes — the other 20 migrations are now actually applied in CI at all, catching a schema bug
anywhere in them before it reaches `main`), and `rls_negative.sql` itself now also checks
`sale_transaction` (migration 0009, roughly the middle of this project's history) with the
same USING/WITH CHECK pattern already proven on `customer` — a second real data point, not
just a re-run of the same one.

**7. `audit_log`'s missing RLS**, closed with a real migration
(`0023_audit_log_rls.sql`) — the one table in this schema with no policy at all. Still
genuinely unused by any application code (a real, disclosed pre-existing gap, not newly
introduced), but now at least schema-consistent with every other table, rather than a trap
for whenever real audit logging gets built.

**Tests**: every individual module's test suite passes — confirmed via batched runs (by
module directory) rather than one single invocation, since a single full-repo `npx jest`
run on this machine hit a real, disclosed environment issue this pass (multiple full-suite
attempts hung indefinitely; individual and grouped runs consistently completed in seconds).
440 real tests pass across those batched runs, 78 skipped (the same Postgres-gated ones as
every other pass this session), plus the full `app.module.test.ts` DI-container boot — which
resolves every one of the newly-guarded controllers' full dependency graph — passing on its
own. `npx tsc --noEmit` is clean.

**Live-verified end to end against a real running server**: `GET /sales/:tenantId` with no
token → real `401`; the same call with a real token for its own tenant → real `200` with
real pagination metadata; the same call with that token against a *different* tenant's id →
real `403 CrossTenantAccessError`; `POST /catalog/:tenantId` with no token → real `401`;
`POST /bookings/:tenantId`, `POST /ratings`, and `POST /nps` with no token at all → all still
succeed, exactly as designed; a booking request missing `customerId` and a rating with
`stars: 11` → real `400`s from the actual `ValidationPipe`, not a hand-written check; five
real sales recorded and paginated two at a time, correctly returning items 3-4 on page two
with the real total (5) unchanged, and an absurd `limit=999999` correctly clamped to 200
rather than returned unbounded.

## What was deliberately NOT built yet — do not add without reading this

- **PayFast/Yoco/Ozow stub — do not write one yet.** Master Plan v1.2, Section 17 is
  explicit: resolve the merchant-of-record question first (platform-collects-on-behalf-
  of-tenants vs. each-tenant-holds-their-own-account) — it changes the interface shape,
  not just the implementation. Writing a stub ahead of that decision would need to be
  redone.
- `privacy-policy.html` — **now drafted** (see root of this repo), and filled in with real
  business details provided 2026-09-08: registered company name ("Mytrima LPtY/LTD" —
  flagged inline in the document itself as entered exactly as given, likely meant as
  "(Pty) Ltd," pending confirmation before publication), registered address, general
  contact email/phone, and an Information Officer name + email (Motsasa Raleche,
  rmotsasa@mytrima.co.za — also flagged inline: that email's `.co.za` domain differs from
  the company's own `.co.ls` domain used everywhere else in the document, worth confirming
  that's intentional). **Naming an Information Officer is not the same as POPIA's actual
  registration requirement** — the document says so explicitly: that designation still
  needs to be registered with the Information Regulator before this section is finalized.
  Hosting region and retention period were also provided 2026-09-08, now filled in:
  Section 6/7 correctly reflect the already-decided AWS Africa (Cape Town) hosting
  (previously left as a stale "decision pending" placeholder even after that decision
  was actually made — caught and fixed here), and Section 8 states a 12-month uniform
  retention period, flagged inline as a single blanket figure rather than the
  per-data-category breakdown Master Plan Section 11 anticipates (audit logs, payment
  references, and consent records may legally need their own different periods) — worth
  confirming with counsel before publication.
  Company registration number (2011-52148) was provided 2026-09-08 too — every
  business-fact placeholder this document originally shipped with is now filled in.
  **What's left is exclusively legal-counsel- or vendor-outreach-dependent, not something
  a business fact can answer**: confirming each data category's lawful basis, the
  controller/processor split, applicable age threshold, DSAR response timeframe, change-
  notice method, and Lesotho's own legal framework (all need counsel); the final
  WhatsApp BSP/access route and payment gateway vendor (both mid-outreach — see "Before
  any of this goes further" below); and the publication date itself, which by definition
  can't be set before the document is actually live. It is **not reviewed by
  legal counsel and not hosted at a live
  URL** — both required (Master Plan Section 9/16) before it satisfies Meta's App Review
  requirement or should be treated as Mytrima's actual privacy policy.
- Dashboard/reporting layer, admin console — no code, and no UI design exists to build
  against (Master Plan Section 1 explicitly excludes UI design from its scope).
- ~~Actual notification *delivery* (WhatsApp/email send, queueing/scheduling) — only the
  trigger/rule logic is built~~ — **done for WhatsApp, 2026-09-10**: a real BullMQ
  queue + worker exist, and a real WhatsApp send now genuinely succeeds when a tenant has
  set a notification phone — see "Real notification delivery" and "WhatsApp: from
  'Assumed' to a real, live-verified send" below. What's still not delivered is the
  notification's actual message content (Meta's own pre-approved `hello_world` sample
  template stands in until a real, business-specific template is submitted and approved —
  see that section for why), and there is no email channel configured anywhere either.
- The Postgres-backed stores (`pg-consent.store.ts`, `pg-rating.store.ts`,
  `pg-auth-user.store.ts`) **exist, are live-tested, and are now wired into the running
  app** — see "Wired into the running app — and proven to survive a real restart" above.
  Cross-restart persistence was actually verified, not assumed.
- ~~No `customer`-creation endpoint exists anywhere~~ — **done, and since expanded into a
  real minimal CRM** (get one, edit, search, customer activity view) — see "A real minimal
  CRM — get, edit, search, and a real partial-update bug it caught" below. Deliberately
  still not built: conversation history (Master Plan assigns that to a separate Messaging
  Service, and there is no message data anywhere in this system yet — a real WhatsApp
  *send* now exists, but nothing here stores or threads customer replies) and merge/dedup
  (no product spec exists for it anywhere in the
  Master Plan, and it's too risky a data operation — what happens to two customers'
  existing ratings/consent history on merge — to guess at without one).
- ~~Redis/BullMQ (Master Plan Section 4) — no background job/queue runtime exists~~ —
  **done**: a real BullMQ queue + in-process worker now exist, live-verified against a real
  Redis-compatible server, and — **as of 2026-09-10** — an actual message now genuinely
  reaches a real phone via a real WhatsApp send, not just a queued-and-failed job. See
  "Real notification delivery: BullMQ, a real queue, and a Memurai discovery" and
  "WhatsApp: from 'Assumed' to a real, live-verified send" below. What's still not
  delivered is the notification's real content (stands in for `hello_world` until a real
  template is approved) and an email channel (not built at all).

## On the tech stack

This **is now** the NestJS + TypeScript stack the Master Plan recommends (Section 4) —
not the dependency-free `tsx`/`node:test` scaffold this repo started as. That earlier
version existed only because it was first authored in a sandbox with no npm registry
access; once real registry access was confirmed available, it was migrated per the
Master Plan's own instruction to do exactly that "when a real engineering environment
with registry access exists" (see `package.json`'s `notes.history` field for the
blow-by-blow).

Two deliberate version/dependency decisions worth knowing before you `npm install` a
newer major and wonder why things break:

- **NestJS is pinned to v11.x, not v12.x.** NestJS v12 shipped as ESM-only (`"type":
  "module"`, no CommonJS build at all) — adopting it would force this entire codebase
  onto ESM (explicit `.js` extensions on every relative import, an ESM-aware Jest setup)
  for no functional benefit at pilot stage. v11.x still ships plain CommonJS and is fully
  current and supported. See `package.json`'s `notes.nestjs_v11_not_v12` field.
- **TypeScript is pinned to 6.0.3, not 7.x.** `ts-jest` (the current stable release, as of
  this writing) declares a peer dependency of `typescript@>=4.3 <7` — TypeScript 7 isn't
  supported by ts-jest yet.
- **`auth/password.ts`, `auth/jwt.ts`, and `auth/totp.ts` still hand-roll their crypto**
  on Node's built-in `crypto` instead of adding `bcrypt`/`jsonwebtoken`/`otplib`. That was
  never about registry access — see the comments in those files for the actual reasoning
  (dependency-count discipline, not sandbox constraints) — so it carried over unchanged.
- **`bullmq` (and its required `ioredis` peer) is a genuine exception to that discipline,
  not a lapse in it.** A real job queue with retry/backoff semantics has no reasonable
  hand-rolled substitute, and Master Plan Section 4 names Redis/BullMQ specifically. See
  `package.json`'s `notes.bullmq_is_a_real_dependency_not_a_stub` field, and "Real
  notification delivery" above for why `ioredis` had to be added separately too.

**A cosmetic Jest quirk, not a code defect**: `npm test` may print "A worker process has
failed to exit gracefully" after all tests pass. This is a known Jest parallel-worker
teardown quirk (confirmed here: it disappears entirely under `jest --runInBand`, and
`jest --detectOpenHandles` finds nothing to report even in parallel mode) — not a real
resource leak in this codebase.

## Before any of this goes further

Per Master Plan v1.2, Section 17 (Consolidated Verification Checklist), none of the
following have happened, and build work on the gated integrations should not proceed
until they do:

- ~~WhatsApp Business API access route, cost, and template-approval turnaround
  confirmed~~ — **access route resolved 2026-09-10**: direct Meta Cloud API, via the same
  Meta Developer app already registered for Facebook/Instagram — not Twilio, 360dialog, or
  any other BSP; the earlier 2026-09-08 Twilio "Talk to Sales" outreach is superseded by
  this, since a real client and a real live send now exist without needing a third-party
  BSP at all. **Still not confirmed**: real production cost past any free tier, and
  template-approval turnaround for a real, business-specific template (development-mode
  testing needed neither — see "WhatsApp: from 'Assumed' to a real, live-verified send"
  above).
- ~~Google Business Profile API quota and field availability confirmed~~ — **done**, and
  the per-tenant OAuth consent flow has been proven live end-to-end too (see "Google
  Business Profile: OAuth flow proven live" above). ~~Host `privacy-policy.html` at a
  live URL (the consent screen requires it)~~ — **done, 2026-09-10** (see above). What's
  left: apply for **separate** "Basic API Access" for `mybusiness.googleapis.com` at
  [support.google.com/business/contact/api_default](https://support.google.com/business/contact/api_default)
  — this is a real-world step only the account owner can take (confirm the test listing
  is verified + active 60+ days with a website first, or expect rejection); build the
  persistent per-tenant refresh-token store for the saved Google OAuth tokens themselves
- Meta Business Verification + App Review submitted for Facebook/Instagram (budget 2–4
  weeks). **Progress 2026-09-09**: registered as a Meta Developer and created the app
  itself — **App ID `1593761498813893`** ("Mytrima," Business type). Not yet done:
  Business Verification (needs real business documents submitted), requesting the actual
  permissions (`pages_show_list`, `pages_manage_posts`, `pages_read_engagement`,
  `instagram_basic`, `instagram_content_publish`, `business_management` — the exact set
  `meta.service.ts`'s `publishPost`/`fetchEngagementSummary` need), and App Review itself
  (needs a screencast of the feature actually working, so the Facebook/Instagram posting
  feature has to be built and demoable first — not just requested on paper). **Further
  progress, same day**: `meta.service.ts` is now a real client (`MetaGraphSocialService`),
  checked against Meta's current Graph API docs, **and live-verified end-to-end** — a real
  Page access token published a real post and read its real engagement summary back, see
  "Facebook & Instagram: a real Meta Graph API client, live-verified end-to-end" above.
  Standard Access (your own Page) is now fully proven, not just built. **Further progress,
  2026-09-10**: the real Facebook Login OAuth flow App Review's screencast actually
  requires ("on your app platform," not Graph API Explorer) is now built
  (`social-publishing/*`) and **live-verified end-to-end** — real consent-screen click,
  real code exchange, real Page saved to Postgres, then a real post created/edited/deleted
  entirely through that saved connection, with zero manually-pasted tokens. See "Facebook &
  Instagram: a real Meta Graph API client, live-verified end-to-end" above for the full
  trace. **Further progress, same day**: Instagram support itself is now built too — Master
  Plan §6's Social Publishing Service was always "Facebook *and* Instagram," only Facebook
  existed before today. `resolveInstagramAccount()` / `publishInstagramPost()`, the new
  `instagram_basic`/`instagram_content_publish` scopes, and a dashboard Instagram post form
  all exist and pass 14/14 new mocked tests — see "Instagram added 2026-09-10" above for
  what's genuinely built vs. what's still an honest gap (no Instagram account linked to the
  test Page yet to live-verify against, same shape of gap as Google Business Profile's).
  Still needed before submission: Business Verification (real business documents — a
  real-world step only the account owner can do), a screencast recording of the now-working
  flow, drafting the App Review "Use Case Description," and the App Review submission
  itself for Advanced Access (serving other tenants' Pages).
- ~~`privacy-policy.html` hosted at a real public URL~~ — **done, 2026-09-10**: live at
  https://rmotsasa-svg.github.io/mytrima-platform/privacy-policy.html via GitHub Pages
  (confirmed reachable, real HTTP 200). Two real business-fact errors fixed in the process
  (company suffix "LPtY/LTD" → "Mytrima (Pty) Ltd"; confirmed the Information Officer's
  `.co.za` email is intentional, not a mismatch with the company's `.co.ls` domain) — see
  its own git history. **Still genuinely open, and the page's own banner says so**: not yet
  reviewed by retained legal counsel (Master Plan Section 16), the specific payment gateway
  vendor (PayFast/Yoco/Ozow), the DSAR response timeframe, and the applicable age threshold
  — publishing satisfied Meta's "must be a live URL" requirement without pretending those
  are resolved.
- ~~`db/tests/rls_negative.sql` run against a live Postgres instance and confirmed to
  actually pass~~ — **done**, both locally and now via the actual CI job in
  `.github/workflows/ci.yml`'s GitHub Actions Postgres service container (see "RLS: proven
  live" above) — this scaffold also has a real git history and GitHub repository for the
  first time as part of proving this
- ~~MoPay's exact transaction-fee rate and settlement time confirmed~~ — **done**
  (**MoPay replied 2026-09-09**: M-Pesa/EcoCash 2.5%, card 3.5%, a once-off M500
  onboarding fee, 2–3 business day settlement — see "MoPay: a real integration, live-
  verified against the actual sandbox" above). MoPay is now the one payment integration
  in this document with **nothing left outstanding** — docs, sandbox, the full
  create→pay→verify flow, and now commercial terms are all confirmed. What's left is a
  business decision, not a verification gap: deciding when to move to production
  onboarding (MoPay has already offered to assist once ready).
- ~~Pay-Lesotho API docs, sandbox access, fees, and settlement terms obtained~~ —
  **moot, removed from scope 2026-09-09**: MoPay is fully confirmed and live-verified,
  commercial terms included, so a second, unconfirmed aggregator for the same rails is
  no longer needed. The 2026-09-08 outreach to info@paylesotho.co.ls can be disregarded
  if a reply arrives.
- ~~PayFast/Yoco/Ozow merchant-of-record model confirmed (**before** writing that
  stub — see above)~~ — **done, 2026-09-10**: Mytrima collects on Tenants' behalf
  (platform is the merchant of record), via PayFast's real-time Split Payments feature —
  see "PayFast: a real, live-verified merchant-of-record payment client" below for the
  full build and live-verification writeup, and the Master Plan Addendum v1.4 for the
  formal decision record.
- ~~AWS Cape Town vs. Azure South Africa hosting decision finalized~~ — **done, 2026-09-07:
  AWS Africa (Cape Town), `af-south-1`** (see [`hosting-cost-comparison.md`](hosting-cost-comparison.md)
  for the reasoning), and Terraform for it exists and is `validate`-clean (see
  [`infra/terraform/README.md`](infra/terraform/README.md)). What's left: `terraform
  plan`/`apply` against a real AWS account — enable `af-south-1` (an AWS opt-in region) at
  the account level first, or the first apply fails with `OptInRequired`.
- Lesotho-specific data-protection counsel engaged (separate from POPIA)
- A security advisor has reviewed the RLS tenant-isolation design before the first real
  tenant record is written

## Running this yourself

```bash
npm install         # real registry install now — no longer dependency-free

npm test            # runs all 262 tests needing neither dependency — always green

# To also run the tests gated behind a real PostgreSQL instance (see "Real
# Postgres-backed stores" above for what these actually prove):
TEST_DATABASE_URL="postgresql://mytrima_app:<password>@localhost:5432/mytrima" npm test -- --maxWorkers=4
# --maxWorkers=4 avoids the connection-contention flakiness running dozens of
# suites' worth of real Postgres connections at full parallelism can cause —
# see this file's own note on it.

# To also run the tests gated behind a real Redis-compatible server (see
# "Real notification delivery" below for what these actually prove):
TEST_REDIS_URL="redis://127.0.0.1:6379" npm test -- --maxWorkers=4
# -> with both TEST_DATABASE_URL and TEST_REDIS_URL set: 324/324 expected —
# see this file's own note above on why that count is expected, not
# freshly re-confirmed, as of 2026-09-10.

npm run typecheck   # tsc --noEmit — clean, no errors expected
npm run build       # nest build -> dist/
npm start           # node dist/main.js — actually booted and curl-tested, see above
# Set REDIS_URL too (e.g. redis://127.0.0.1:6379) to enable real notification
# delivery attempts via the BullMQ queue/worker — see below. Without it, the
# app boots exactly as before and every notification-producing endpoint still
# works; nothing is enqueued, same as DATABASE_URL's fallback to in-memory.
```

### A note if you develop this in Windows' Documents folder

Windows Defender's **Controlled Folder Access** blocks `node.exe`, `npm`, and most CLI
tools from writing inside `Documents\` by default (a ransomware-protection feature). If
`npm install` or `npm test` hangs indefinitely with no output and no error when run from
here, that's almost certainly why — not a slow install. Either add an exclusion (Windows
Security → Virus & threat protection → Manage ransomware protection → Controlled folder
access → Allow an app through Controlled folder access → add `node.exe`), or move this
folder outside Documents (e.g. `C:\dev\mytrima-platform`).

## A real SPA frontend — 2026-09-11

"Lets do a real SPA" — the tenant's own request, and the exact decision the
Platform Readiness Assessment's own "What's left" section had named as the
one thing actually still gating frontend work: *Server-rendered pages vs. a
real SPA calling this API through `CORS_ORIGIN`.* Answer: a real SPA.
`frontend/` is a separate, independently-deployable React 19 + TypeScript +
Vite app — not a mockup, not generated, not embedded in this NestJS app.
It talks to this backend over plain HTTP through the CORS support already
added for exactly this (`src/common/cors.ts`, `main.ts`).

**What it covers**: real login (including the first-owner MFA-enrollment
walk this README already documents for the API itself), the Business
Snapshot report, a Getting-started onboarding checklist, Sales (paginated,
record-a-sale), Customers, Catalog, Bookings (the tenant-staff side —
confirm/decline/complete/no-show/cancel), Staff (list/role/deactivate/
reactivate/invite/self-service password), and Support tickets. See
`frontend/README.md` for the full breakdown, including what it deliberately
does NOT cover yet (Deals, Petty Cash, Growth Audit, NPS/Rating, Payments,
Social Publishing all have real gated endpoints already — just no page
here yet).

**Added 2026-09-11, on request ("lets check onboarding page")**: the
Getting-started checklist against `GET /onboarding/:tenantId` — a pure
computed status, no stored flag, no write path on the backend (see
`onboarding.service.ts`'s own top comment). Live-verified on a second,
freshly-registered tenant: opened the page before touching anything (real
0 of 5, 0%), added a customer through the SPA, went back — real 1 of 5,
20%, progress bar updated, and that one step flipped from "To do" to
"Done" with its link gone, proving it's actually recomputed from real
account data on every load rather than cached client-side.

**Added 2026-09-11, on request ("lets check setting page")**: a Settings
page — owner-only, matching `tenant:manage_settings`/`social:manage`
being owner-only permissions in `rbac.ts` — covering the three real tenant-
level settings the onboarding checklist itself names: the WhatsApp
notification phone (`PATCH /auth/tenants/notification-phone`), the PayFast
merchant id (`POST /payments/:tenantId/merchant-id`), and the Facebook Page
connection (`GET /social/:tenantId/connection`, `GET /social/:tenantId/
connect`). One honest constraint the page is built around: this API has no
endpoint that returns a tenant's *current* phone number or merchant id —
both are write-only — so the "Set"/"Not set" badges come from the
onboarding checklist's own boolean signals, not the stored value itself.
Live-verified on a third fresh tenant: saved a real phone number and a real
merchant id, watched both badges flip and the onboarding checklist (reading
the same backend state, not a separate flag) move from 0-of-5 to 2-of-5,
40%; confirmed the Facebook connect link is built with the real tenant id
and that the endpoint truly 302s to Facebook's OAuth dialog (checked with
curl, not followed through — no real Meta App credentials are configured
in this dev pass, so the redirect's `client_id` is honestly empty).

**Added 2026-09-11, on request ("growth audit page")**: a Growth Audit
page — the real 40-question, 7-section instrument, rendering whatever
`GET /growth-audit/questions` returns rather than a hardcoded copy,
submitting to `POST /growth-audit`, and showing the latest result, full
history (`GET /growth-audit/:tenantId`), and the recommendation engine's
output (`GET /growth-audit/:tenantId/recommendations` — ranked opportunity
sections, recommended actions, self-report-vs-real-signal divergences, and
the action-to-action completion rate). Submitting is owner/staff only,
matching `growth_audit:submit` not being in read_only's permission set.
The five 0–4 scale labels are this SPA's own plain-English gloss, disclosed
as such — this repo has no copy of `Mytrima_Growth_Audit_Questionnaire.docx`
to quote verbatim.

Live-verified on a fourth fresh tenant: answered all 40 real questions
(every one "2 — Partially in place," through the actual radio inputs, not
faked), submitted, and got back a real backend-computed 50.0/100 overall
score, "Weak" band, and 50% on every section — the exact arithmetic
`scoreAudit()` should produce at the midpoint (hand-checked: each
section's weightPct × 0.5, summed, equals 50.0). Confirmed the
recommendation engine's edge case — no answer fell below its weak-answer
threshold, so "No specific actions surfaced" rendered cleanly rather than
erroring — and that the onboarding checklist's `growth_audit` step flipped
to Done afterward, reading the same shared backend state.

**Added 2026-09-11, on request ("customer experience page")**: this one
started with a real BACKEND gap, not just a missing page. Building the
SPA's Customer Experience view (star ratings + NPS surveys) surfaced that
`RatingService.findAllForTenant()` and `NpsService.findAllForTenant()` had
existed since these modules' earliest pass — SnapshotService and
RecommendationService already called both internally — but neither had an
HTTP route. `POST /ratings/:id/moderate` was practically unreachable by
any real client as a result: it needs a rating's id, and there was no way
for a tenant to ever see one. Fixed first, as its own commit: added
`GET /ratings/:tenantId` and `GET /nps/:tenantId`, reusing the exact
permissions their `:tenantId/aggregate` siblings already check
(`rating:view`, `growth_audit:view`) — same data at a finer grain, not a
new capability. `npx tsc --noEmit` clean; full `src/modules` test run: 400
passed, 78 skipped (Postgres-gated), 0 failures.

Then the SPA page itself: both lists, both aggregates, and a moderation
queue — publish/hide buttons on each pending rating, gated to owner/staff
(read_only can view, matching `rating:moderate` not being in its
permission set).

Live-verified end-to-end on a fifth fresh tenant: submitted two ratings and
two NPS responses as an actual unauthenticated customer would (curl, no
SPA involved — matching how they're really submitted), then opened the
page as the owner — real data, with the rating average correctly excluding
the still-pending one and the NPS aggregate showing 0 (a 9 and a 3
cancelling out, real math). Clicked "Publish" on the pending rating from
inside the SPA itself and watched the average recompute live from
`{averageStars:0,count:0}` to `3.5/5 across 2 reviews`, matching
`RatingService.aggregateForTenant()`'s own pending/public split exactly.

**Added 2026-09-11, on request ("reports page")**: a Reports page one
level below the Business Snapshot's executive summary — the raw per-KPI
numbers (`GET /sales/:tenantId/kpis`, `/repeat-rate`, `/lifetime-value`)
plus Sales Targets and KPI Benchmarks (list + set, owner/staff only for
writes), driven by a period picker.

**Found and fixed a real bug in this page while live-verifying it**, not
after the fact: every KPI tile read zero despite a real sale existing.
Root cause — the period picker's default "To" date, a bare `YYYY-MM-DD`,
went straight to the backend, whose `new Date(periodEnd)` parses a bare
date as that day's UTC *midnight*, the start of today, not its end; a
same-day sale then fell after `periodEnd` and silently dropped out of
every KPI. Fixed by pushing "To" to `23:59:59.999Z` before it ever leaves
the page, applied to the KPI/repeat-rate query and the Target/Benchmark
forms alike. Reloaded — real numbers appeared. Also caught and fixed a
second, smaller issue in the same pass: this page's own frontend type for
`GET /sales/:tenantId/lifetime-value` was missing the `| null` the backend
actually returns (a real, honest "not enough data yet" answer until a
customer has a second purchase, from `computeLifetimeValue()`'s own
documented early-return) — fixed the type and gave the card real copy for
that state instead of a bare "—".

Live-verified end-to-end on a sixth fresh tenant: added a catalog item,
customer, and sale through the SPA, confirmed the bug, fixed it, reloaded
to real KPI numbers (`LSL 900,00`, 1 transaction, 2 units). Recorded a
second sale for the same customer and watched Repeat rate flip to a real
100% and Customer Lifetime Value move off `null` to a real computed value.
Set a real Sales Target and a real KPI Benchmark through their own forms
and confirmed both listed back correctly. `npx tsc -b` and `npm run build`
both pass clean; oxlint unchanged (style warnings only).

**Live-verified, not assumed** — driven through an actual browser (not
curl standing in for one), against the real compiled backend
(in-memory stores, same degrade-cleanly pattern as everywhere else in this
README) with `CORS_ORIGIN`/`TENANT_SIGNUP_CODE` set and the SPA's own real
Vite dev server on a fixed port:

1. Registered a real tenant, hit the real first-owner MFA-enrollment screen,
   generated a real TOTP code with the backend's own `totp()`, confirmed
   enrollment, and logged in again with a fresh code — a real access/refresh
   token pair, not a stub.
2. Added a real catalog item and customer, recorded a real sale from live
   dropdowns, and watched the Snapshot page's executive summary and stat
   tiles reflect it on the next load.
3. Filed a booking the way an actual customer would — a plain unauthenticated
   `curl POST /bookings/:tenantId`, no SPA involved, since a customer has no
   Mytrima account anywhere in this system — then confirmed it from the
   Bookings page and watched its status and available actions change live.
4. Filed a real support ticket through the form; it round-tripped with a
   real `createdAt` and `open` status.
5. **Found and confirmed a real, deliberate design working correctly, not a
   bug**: tried to deactivate the tenant's sole owner from the Staff page —
   the backend's real `CannotRemoveLastOwnerError` came back as an actual 409
   and rendered as an error banner instead of a stack trace or a silent
   no-op. The browser's own network log also showed React's dev-only
   double-effect firing two `GET /staff/me` calls at once on first load, yet
   only one `POST /auth/refresh` went out — proving the single-flight
   refresh dedup in `frontend/src/api/client.ts` actually works (a second
   concurrent refresh call would have rotated the refresh token out from
   under the first one, since `auth.service.ts`'s refresh tokens are
   single-use).
6. Reloaded the page mid-session on a deep route (`/sales`, not `/`) —
   session restored silently from the stored refresh token, correct route
   still rendered, no bounce to the login screen.

`npx tsc -b` and `npm run build` both pass clean inside `frontend/`;
`npx oxlint` reports only style warnings, zero errors.

**Honest gap**: no frontend automated test suite yet (no Vitest/React
Testing Library) — everything above is a real, one-time manual
browser-driven verification pass, not a repeatable one. The backend's own
Jest suite (440 passing, 78 skipped — see this README's own Platform
Readiness section) is untouched by anything in `frontend/`.

## SPA Readiness Assessment — 2026-09-11

A grounded, live-verified audit of the SPA itself (companion to the
Platform Readiness Assessment above, which only covered the backend).
Registered a real `read_only` staff account through the live API and
logged it into the SPA directly to confirm RBAC actually holds at the UI
layer — every manage control (Sales' "Record a sale", Catalog's "Add
item", Staff's whole management section, Settings entirely) was correctly
absent across five pages clicked through as that session, while every read
view rendered real cross-role data. Also: 0 npm vulnerabilities, 0
`dangerouslySetInnerHTML`/`eval`/raw `innerHTML`, 0 `any` types across 22
source files, and — tested live at a real 375×812 viewport — a genuine,
now-disclosed finding that the mobile nav overflows with no scroll
affordance.

**The one finding fixed immediately**: `.github/workflows/ci.yml` had zero
frontend coverage — every "tsc -b and vite build both pass clean" claim
across seven SPA commits was true but verified only locally, never gated
on a push. Added a fifth job, `frontend-build`, mirroring
`test-and-typecheck`'s own shape (checkout, setup-node, install) but
scoped to `frontend/` via `working-directory` (it's a separate npm project
with its own lockfile): `npm ci`, `npm run build` (`tsc -b && vite build`),
`npx oxlint`. Verified locally before pushing — a clean `npm ci` from a
deleted `node_modules`, then `npm run build` and `npx oxlint` both exiting
0 — and the workflow file itself parsed with `js-yaml` (already present as
a transitive dependency) to confirm the new job's structure before trusting
GitHub Actions to parse it.

## Closing the SPA Assessment's remaining technical findings — 2026-09-11

Three of the four remaining findings, fixed the same day:

**No React error boundary** — `src/components/ErrorBoundary.tsx` (new): a
class component (the one place in this app that has to be one —
`getDerivedStateFromError`/`componentDidCatch` have no stable hook
equivalent) wrapping `<Outlet/>` inside `Layout.tsx`, keyed on
`location.pathname` so navigating away from a crashed page resets it
automatically. Shows the real error message plus "Try again" (re-renders
the same route) and "Go to Snapshot" (a real way out). Live-verified by
temporarily making a real page throw on render, confirming the sidebar
stayed intact and interactive while only the content area showed the
fallback, confirming `componentDidCatch` logged the real stack trace, and
confirming "Go to Snapshot" actually recovered the app — then reverting
the test throw and confirming the page rendered normally again.

**No route-level code splitting** — every page in `App.tsx` now goes
through `lazy()` instead of a static import; `<Suspense>` lives inside
`Layout.tsx` around the `<Outlet/>` (not around the whole route tree in
`App.tsx`), so only the content area shows "Loading…" while a chunk
fetches and the sidebar never unmounts. Real, measured result: the single
331 KB bundle split into the shared 277 KB shell plus 12 separate
per-page chunks (2–10 KB each) — confirmed from `vite build`'s own output,
not assumed from the source change alone.

**Mobile nav overflow** — replaced the old "sidebar turns into a
horizontally-scrolling row" rule with a real collapsed-drawer pattern:
`Layout.tsx` gained a hamburger toggle and `Layout.css` a proper
`<760px` drawer (fixed-position panel, tap-to-close scrim, closes itself
on navigation via a `location.pathname` effect). Building this live at a
real 375×812 viewport surfaced two further real bugs, found by direct
`getBoundingClientRect()`/`getComputedStyle()` inspection, not guessing
from the CSS: (1) a wide `<table>` on any page (Sales' own data-table, for
one) forced the whole single-column mobile grid track wider than the
viewport, stretching the sidebar to 539px on a 375px screen — fixed with
`min-width: 0` on `.shell-content`, the standard fix for a grid/flex item
that must be allowed to shrink below its content's own min-content size;
(2) CSS Grid's default `align-content` behaves like "stretch" for
auto-sized row tracks whenever the container has leftover height (`.shell`'s
own `min-height: 100vh`), which was distributing that leftover space into
the now much-shorter header's row instead of after it, leaving a ~245px
dead gap between the closed header and the page content — `align-self:
start` on the item was tried first and confirmed insufficient (it only
stops the item's own content from stretching, not its track); the actual
fix is `align-content: start` on the grid container itself. Live-verified
end to end: opened the drawer (all 12 links reachable, account/sign-out
included), tapped a link and confirmed it both navigated and closed the
drawer automatically, and confirmed the gap and width bugs were gone by
re-measuring after each fix rather than assuming from the CSS.

`npx tsc -b`, `npm run build`, and `npx oxlint` all still pass clean.

**Not yet fixed**, by decision (a larger scope than a bug fix): four real
backend domains — Deals, Petty Cash, Payments checkout/ITN log, and
social posting/engagement — still have no SPA page. See the published
assessment artifact for the original findings and full live-verification
trace this section closes out.

## Business profile — closing a real platform-wide gap, not just an SPA one — 2026-09-11

The tenant asked directly: "business set up page where is it, where
tenant upload business info — business description, contacts, location,
industry, business goal." The honest answer was that it didn't exist
anywhere — not the SPA, not the API, not the schema. The `tenant` table
(migration 0001) had `id`/`name`/`country`/`status` plus two later
integration fields (notification phone, PayFast merchant id); nothing else.
There was also no `GET` endpoint anywhere that returned a tenant's own
record at all — `TenantService.getById()` existed and was used internally
(PaymentsController, OnboardingService) but had no HTTP route, so even the
tenant's own name was unreadable by any real client. Products/services
with prices already had a real home (Catalog, migration 0002) — this gap
was everything else a "business setup" page needs.

**Migration 0024** adds six nullable columns to `tenant`: `description`,
`industry`, `location`, `contact_email`, `contact_phone`, `business_goal`.
`contact_email`/`contact_phone` are deliberately separate from the existing
`notification_phone_e164` — that one is where WhatsApp automation sends
internal alerts; these two are the business's own public-facing contact
details.

**Two new endpoints** on `AuthController`: `GET /auth/tenants/me` (any
authenticated role, reusing `reports:view` — the one permission every role
already has, since there's no reason a read_only staff member shouldn't
see their own employer's profile) and `PATCH /auth/tenants/business-profile`
(owner-only `tenant:manage_settings`, matching the pattern every other
tenant-level settings endpoint already uses). Every field on the PATCH is
optional — a tenant fills this in incrementally — and a field present but
blank after trimming clears it rather than erroring, a deliberately looser
rule than `tenantName` gets at registration: there's no reason a business
can't decide it no longer wants a stated goal on file.
`TenantService.setBusinessProfile()` validates `contactEmail`/`contactPhone`
shape (loosely, same "right-sized for pilot" judgment as every other
pattern-checked field in this file) but places no constraint on the four
free-text fields — there's no wrong shape for a sentence describing what a
business does. `PgTenantStore.updateBusinessProfile()` builds its `SET`
clause dynamically from only the keys actually present, so a partial
update genuinely only touches the columns it names — proven against a real
Postgres `UPDATE`, not just the in-memory store's own object-spread, in a
new integration test (`pg-tenant.store.test.ts`, Postgres-gated, currently
skipped in this environment for the same disclosed reason every other
Postgres-gated test here is).

**A free bonus fix, done in the same pass**: the onboarding checklist
(`onboarding.service.ts`) gained a sixth real step, `business_profile`
(`!!tenant?.description`), positioned first — every other step makes more
sense once someone can say what the business actually is. All 40+ existing
onboarding tests updated for the new 6-step total rather than skipped or
loosened.

Live-verified end to end via curl before the SPA page existed: registered
a tenant, confirmed `GET /auth/tenants/me` returned just `{id, name}` on a
fresh tenant, `PATCH`ed all six fields, confirmed the full real record came
back on the next `GET`, confirmed an invalid `contactEmail` gets a real 400
(`InvalidContactEmailError`, registered in `http-exception.filter.ts`'s
error-to-status map — a step this project has been bitten by forgetting
before), and confirmed a partial PATCH naming only `industry` left every
other field untouched. `npx tsc --noEmit` clean; `src/modules` test run:
411 passed, 79 skipped (Postgres-gated) — see `frontend/README.md` for the
matching SPA page's own live-verification trace.

## Website analytics — a module the tenant asked for directly, from scratch — 2026-09-11

The tenant asked directly: "we did not build a module that will help to
connect tenants website and monitor, report analytic for tenants." A real
grep confirmed it: nothing anywhere in this codebase connected to a
tenant's own website, monitored it, or reported traffic analytics. This
was really two different features hiding under one request — website
uptime/error monitoring, and visitor analytics — with genuinely different
cost, dependency, and (for analytics specifically) privacy profiles, so
the tenant was given a real comparison (connect an existing Google
Analytics property via OAuth, vs. Mytrima hosting its own first-party
tracking snippet) rather than one silently picked for them. **The tenant
chose the first-party tracking snippet** — the only option that works for
a tenant with no analytics already set up, the more likely case for this
pilot's own cohort — explicitly over the simpler "monitoring only"
starting point this project would otherwise have recommended.

That choice carries a real privacy weight the Google Analytics option
wouldn't have: this feature holds behavioral data about a tenant's own
SITE VISITORS — people with no Mytrima account and no way to have
consented to Mytrima specifically. The whole design is built around
minimizing that footprint, documented at length in **migration 0025**
(`website_visit` table) and `website-visit.service.ts`'s own top comments,
summarized here:
- **No IP address, ever, not even transiently.** `country` is populated
  only when a trusted edge/proxy already resolved it (a `CF-IPCountry`-
  style header) and passed just the two-letter code along
  (`AnalyticsController.readCountry()`); this app never reads the
  request's own IP and performs no GeoIP lookup of its own. A tenant not
  served through such an edge simply gets no country data — a real,
  disclosed gap, not one papered over by reaching for the IP instead.
- **No raw User-Agent string, ever.** `classifyDeviceType()` reduces it to
  one of four coarse buckets (desktop/mobile/tablet/other) server-side;
  the raw string is discarded in the same request, never logged, never
  passed to any store.
- **Session-scoped, not persistent, visitor id.** The tracking snippet
  generates its `sessionId` client-side and keeps it only in
  `sessionStorage` — reset every browser session, not a years-long cookie.
- **No cross-tenant or cross-site linkage of any kind.**

**The tracking snippet itself** (`tracker-snippet.ts`, served at
`GET /analytics/tracker.js`) is a single `<script>` tag a tenant pastes
onto their own site:
`<script src=".../analytics/tracker.js" data-tenant-id="<id>" async></script>`
— the tenant id lives in the tag's own `data-tenant-id` attribute (the
same technique Plausible/Fathom-style trackers use), and the API origin
to post to is derived from `currentScript.src` itself, so the one served
file works unmodified in dev, staging, and production. Every network
failure inside it is swallowed — a tenant's own site must never break or
throw a console error because of this tracker.

**Backend**: `POST /analytics/collect/:tenantId` is deliberately
unauthenticated (same reasoning as Booking/Rating/NPS's own public
writes — a site visitor is not a Mytrima account holder) and rate-limited
60/min per client IP. `GET /analytics/:tenantId/summary` is authenticated
and reuses the existing `reports:view` permission rather than inventing a
new one, matching this project's established "don't invent a permission
split nothing has asked for" discipline (`rbac.ts`'s own comment).
`AnalyticsService`/`computeAnalyticsSummary()` are pure and separately
unit-tested against hand-built fixtures — total visits vs. unique
sessions, top-paths/top-referrers ranking, "Direct" labeling for a missing
referrer, device breakdown, and day-bucketing. `PgWebsiteVisitStore`
follows the exact `runWithTenantContext` pattern `PgBookingStore` already
proved for a public write with a caller-supplied (not verified-actor)
tenant id, with its own Postgres-gated integration test
(`pg-website-visit.store.test.ts`, currently skipped in this environment
for the same disclosed reason every other Postgres-gated test here is).
`db/tests/rls_negative.sql` gained a third parallel table check
(`website_visit`, alongside its existing `customer`/`sale_transaction`
checks) — insert, cross-tenant visibility, and cross-tenant-insert-
rejection, all proven by the same script CI already runs.

**CORS**: a tenant's own website is an origin this app can't enumerate in
`CORS_ORIGIN` ahead of time the way it can the one SPA dashboard origin —
so `main.ts` adds a small Express middleware scoped to exactly
`/analytics/collect` (not the whole `/analytics` prefix, which also holds
the authenticated, credentialed `summary` route) that sets
`Access-Control-Allow-Origin: *` with no `Access-Control-Allow-
Credentials` — safe because that one endpoint carries no cookies or auth
of any kind. Registered before the origin-allowlisted `enableCors()` call,
so the rest of the API's CORS posture is unaffected.

**Frontend**: `WebsiteAnalyticsPage.tsx` — a "Connect your website" card
with the exact snippet to paste (a real copy-to-clipboard button, with a
graceful select-and-copy-by-hand fallback if clipboard access is denied),
a period picker (reusing the same UTC-end-of-day fix `ReportsPage.tsx`
already proved necessary), summary stat tiles, a visits-by-day bar chart,
top-pages/top-referrers tables, and a device breakdown — all rendering a
real, disclosed empty state ("No visits recorded yet for this period")
rather than fabricated zeros when nothing has come in yet. Code-split via
`lazy()` like every other page since the SPA Readiness Assessment fix, and
added to the nav.

**A real bug found live-verifying this**: an empty-path beacon threw
`InvalidVisitError`, which — unregistered in `http-exception.filter.ts`'s
error-to-status map — surfaced as a raw 500 instead of the 400 it actually
is. Fixed by adding it to the map (the exact bug class this filter exists
to prevent, and the exact mistake this project already made once before
with `InvalidContactEmailError`/`InvalidContactPhoneError`).

Live-verified end to end against a real running server: logged in as the
demo tenant, sent real beacons via curl with real mobile/desktop/tablet
User-Agent strings and a foreign `Origin` header (confirming the scoped
CORS middleware actually returns `Access-Control-Allow-Origin: *` for
`collect` and nothing extra for `summary`), confirmed `GET
/analytics/:tenantId/summary` came back with correctly aggregated real
numbers (3 sessions, 6 page views, correct top-path/referrer counts,
correct device split), confirmed the empty-path 400 fix, confirmed an
unauthenticated `summary` call is rejected with 401, and confirmed
`GET /analytics/tracker.js` serves real, executable JS with the right
`Content-Type`. Then opened the real SPA in a browser, logged in, and
confirmed the Website Analytics page renders the exact tenant-specific
`<script>` tag and the same real aggregated numbers the API returned — see
`frontend/README.md` for that trace's own detail. `npx tsc --noEmit`
clean on both backend and frontend; `npm run build` clean on both; full
backend test run: 469 passed, 84 skipped (Postgres-gated, same disclosed
reason as every other gated test here) — one unrelated pre-existing flake
in `app.module.test.ts` (a bcrypt-timing test that exceeds Jest's 5s
timeout only under this run's own parallel worker load; passes cleanly
run in isolation, confirmed before and after this feature's changes and
not touched by them).

## Self-serve signup, email verification, and a public landing page — 2026-09-11

The tenant asked whether a landing page alongside the SPA would help
prospective businesses find and sign up for Mytrima. Scoped together
before building: signup would become genuinely self-serve (not the
existing pilot's shared `TENANT_SIGNUP_CODE`), protected by real email
verification rather than a shared secret, sending through AWS SES since
this project's own Terraform (`infra/terraform/`) already provisions a
real AWS account. A brand-new self-serve tenant gets exactly what any
tenant gets today — no new tier/trial logic, since nothing in this
codebase enforces `tenant.status` yet anyway (confirmed by grep before
deciding this: the column exists, decorative, unread by any query).

**Migration 0026** adds `app_user.email_verified boolean not null default
true` — true for every existing account (an invited teammate is already
vouched for by the owner who invited them; the old code-gated signup
path). `TenantService.registerTenant()` is the one caller that passes
`false`, for a brand-new self-serve owner nobody has vouched for at all.

**`TenantService.verifySignupCode()` reversed its own "fails closed"
posture, deliberately**: an unset `TENANT_SIGNUP_CODE` used to throw
`TenantSignupNotEnabledError` (signup disabled). It now means "self-serve
signup is open" — the real change the tenant asked for. Setting
`TENANT_SIGNUP_CODE` is still there as an opt-in way back to invite-only
mode (every caller must then supply the matching code again), so nothing
about the original pilot's own deployment behavior changes unless that
var is explicitly unset. `POST /auth/tenants` is now rate-limited (5/hour
per client IP — account creation, not a retry, so tighter than login's
10/5min) and its body (`RegisterTenantBody`) is a real class-validator DTO
for the first time, the same treatment Booking/Rating/NPS/Analytics's own
public writes already have.

**Email verification** (`auth.service.ts`): `issueEmailVerificationToken()`
signs a 24-hour-TTL JWT (same hand-rolled `signJwt`/`verifyJwt` as every
other token type here — access, refresh, MFA enrollment — no new crypto
dependency), `verifyEmailAddress()` verifies it and flips the column
(idempotent — a second click on the same link, e.g. an email client's own
link-prefetch, succeeds again rather than erroring), and
`resendVerificationToken()` re-issues one, returning `null` (never
throwing) for both "no such account" and "already verified" so the
resend endpoint can give an identical response either way — the same
account-enumeration discipline `InvalidCredentialsError`'s own comment
already established. `login()` checks `emailVerified` right after
`isActive`, before the MFA branch — an unverified self-serve owner is
blocked with a new `EmailNotVerifiedError` (401) before even reaching
enrollment.

**Sending the actual email** (`src/modules/integrations/email/`):
`nodemailer` is a genuine new dependency here (documented in
`package.json`'s own `notes` field, alongside `bullmq`'s matching
justification) — hand-rolling MIME/TLS/SMTP-quirk handling for production
mail delivery is a real reliability risk, unlike JWT's fully
self-contained ~100-line algorithm. `SesSmtpEmailService` sends through
AWS SES's SMTP interface (`SES_SMTP_HOST`/`SES_SMTP_USERNAME`/
`SES_SMTP_PASSWORD`, plus optional `EMAIL_FROM_ADDRESS`); unset, it falls
back to `ConsoleEmailService` (logs the real verification link instead of
sending it) — same env-var-presence fallback pattern as
`WhatsAppCloudApiService`/`NotYetVerifiedWhatsAppService`, so self-serve
signup is fully testable with zero configuration. **Real, disclosed
prerequisite not done here**: SES needs domain/DKIM DNS verification on
`mytrima.co.za` before it can actually send from a real address — a
one-time AWS-console/DNS step outside what this session can do.

**`APP_BASE_URL`** (default `http://localhost:5173`, same
env-var-with-a-localhost-default pattern as
`SocialPublishingController`'s own `SOCIAL_REDIRECT_URI`) is where
`TenantService.buildVerificationUrl()` points the emailed link — the SPA's
own new `/verify-email` route, not the landing page, since the SPA
already owns the whole login/session flow.

**`landing/`** — a new, deliberately separate Vite+React project (its own
`package.json`, own dev port 5174), not a route bolted onto `frontend/`'s
router. Real reasons kept separate: the SPA is client-rendered behind
auth (bad for SEO, every route assumes a session); marketing copy changes
on a whim, the app doesn't; and the two can be deployed to entirely
different hosts/domains independently. It reuses the real brand tokens
and logo SVGs from `frontend/` — copied, not imported across projects
(disclosed as a real, hand-kept-in-sync risk in `landing/src/tokens.css`'s
own comment, not hidden behind a shared-package abstraction two small
files don't justify yet). Its signup form calls the same, now-open
`POST /auth/tenants` directly — cross-origin, so the backend's
`CORS_ORIGIN` must list this site's real deployed origin once it has one.

Live-verified end to end: real curl calls proved the open-by-default
behavior (`POST /auth/tenants` with no `signupCode` at all → 201), the
opt-in invite-only mode still works (`TENANT_SIGNUP_CODE` set → a
missing/wrong code gets a real `InvalidSignupCodeError`, the right code
still succeeds), the full email-verification loop (blocked login →
`EmailNotVerifiedError` → verify via the real emailed link → idempotent
re-verify → login proceeds to the normal, unrelated MFA-enrollment gate
exactly as before), the resend endpoint's generic response for both a
nonexistent and an already-verified account, class-validator now rejecting
a malformed signup body with real field-level messages, and the 5/hour
rate limit itself (6th signup attempt in an hour from one IP → 429). Then
opened both the real SPA (`/verify-email`, and `LoginPage`'s new
"resend" banner) and the real landing page in a browser, filled out and
submitted the actual signup form, and confirmed the same real tenant
landed in the backend's own log with a real, clickable verification link
— not curl standing in for a browser. `npx tsc --noEmit` clean across
backend, `frontend/`, and `landing/`; `npm run build` clean across all
three; `npm run lint` clean (zero warnings) on the new `landing/` project;
full backend test run: 486 passed, 84 skipped (Postgres-gated, same
disclosed reason as always).

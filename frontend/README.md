# Mytrima frontend

A real single-page application (React 19 + TypeScript + Vite + React Router) for the Mytrima backend in the parent directory — not a mockup, not a generated stub. It's a separate deployable, calling the API over HTTP through the `CORS_ORIGIN` support the backend added for exactly this (see `../src/common/cors.ts`), the direction the Platform Readiness Assessment's own "What's left" section named as the real product decision still outstanding.

## What's implemented

Every page here calls a real, already-gated backend endpoint — nothing is mocked:

- **Auth** (`src/auth/`) — login, the real first-owner MFA-enrollment walk (start → confirm → log in again with a code, matching `auth.service.ts`'s own documented flow), logout, and silent session restore via the stored refresh token on reload.
- **Snapshot** (`src/pages/SnapshotPage.tsx`) — the Business Snapshot report (`GET /reports/:tenantId/snapshot`).
- **Getting started** (`src/pages/OnboardingPage.tsx`) — the onboarding checklist (`GET /onboarding/:tenantId`), a pure computed status with no write path on the backend (see `onboarding.service.ts`). All five steps now link somewhere real in this SPA.
- **Growth audit** (`src/pages/GrowthAuditPage.tsx`) — the real 40-question, 7-section instrument: renders whatever `GET /growth-audit/questions` returns (never a duplicated/hardcoded copy), submits to `POST /growth-audit`, and shows the latest result, full history (`GET /growth-audit/:tenantId`), and the recommendation engine's output (`GET /growth-audit/:tenantId/recommendations` — ranked opportunity sections, recommended actions, self-report-vs-real-signal divergences, and the action-to-action completion rate). Gated to owner/staff for submitting (read_only can only view, matching `growth_audit:submit` not being in read_only's permission set in `rbac.ts`). One disclosed detail: the five 0–4 scale labels ("Not in place" … "Fully in place") are this SPA's own plain-English gloss, not verbatim wording from `Mytrima_Growth_Audit_Questionnaire.docx` — this repo has no copy of that document to quote.
- **Settings** (`src/pages/SettingsPage.tsx`) — owner-only (`tenant:manage_settings`/`social:manage` are owner-only permissions, see `rbac.ts`): set the WhatsApp notification phone (`PATCH /auth/tenants/notification-phone`), set the PayFast merchant id (`POST /payments/:tenantId/merchant-id`), and see/connect a Facebook Page (`GET /social/:tenantId/connection`, `GET /social/:tenantId/connect`). Note the honest limitation this page is built around: nothing in this API returns a tenant's *current* phone number or merchant id (write-only endpoints) — the "Set"/"Not set" badges come from the onboarding checklist's own boolean signals, not the stored value itself.
- **Sales** — paginated list (`GET /sales/:tenantId?limit=&offset=`, the exact endpoint the Assessment's pagination finding named) and record-a-sale.
- **Customers** — search, list, and add.
- **Catalog** — list, add, activate/deactivate.
- **Bookings** — the tenant-staff side of the Booking module: list, confirm/decline, complete/no-show/cancel. (The customer-facing `POST /bookings/:tenantId` stays what it always was — public, unauthenticated, rate-limited — and has no UI here; a real customer never has a Mytrima login to reach this SPA with.)
- **Staff** — list, change role, deactivate/reactivate, invite, and self-service password change. The "a tenant can never have zero active owners" invariant lives entirely in the backend (`auth.service.ts`) — this UI just surfaces whatever `CannotRemoveLastOwnerError` says, live-verified by trying to deactivate a solo owner and watching the real 409 render as a banner rather than crash the page.
- **Support** — file a ticket, see Mytrima's resolution notes, reopen if it didn't actually fix things.

## Running it

```bash
cp .env.example .env.local   # point VITE_API_BASE_URL at your backend
npm install
npm run dev                  # http://localhost:5173, fixed port (see vite.config.ts)
```

The backend must be started with `CORS_ORIGIN=http://localhost:5173` (or wherever this ends up running) — see the parent repo's `src/main.ts`. Without it, every request from here is silently blocked by the browser itself, not by anything this app does.

## Real, live end-to-end verification (2026-09-11)

Ran against the actual compiled backend (`node dist/main.js`, in-memory stores — no `DATABASE_URL`/`REDIS_URL` set, the same degrade-cleanly pattern documented in the main README) with `TENANT_SIGNUP_CODE` and `CORS_ORIGIN` set, and this SPA's real dev server — driven through an actual browser, not curl standing in for one:

1. Registered a real tenant (`POST /auth/tenants`) and signed in through the login form — landed correctly on the real MFA-enrollment screen (first owner login has no secret yet).
2. Fetched a real TOTP secret from `POST /auth/mfa/enroll/start`, generated a real code with the backend's own `totp()`/`base32Decode()`, confirmed enrollment, and logged in again with a fresh code — reached the dashboard with a real access/refresh token pair.
3. Added a real catalog item, a real customer, and recorded a real sale picking both from live dropdowns populated by their own list endpoints — the Snapshot page's executive summary and stat tiles updated to reflect it on the next load, not a cached or optimistic value.
4. Created a booking the way an actual customer would — a plain unauthenticated `curl POST /bookings/:tenantId`, no SPA involved — then confirmed it from the Bookings page and watched its status pill and available actions change for real.
5. Filed a real support ticket through the form; it round-tripped and rendered with its real `createdAt` and `open` status.
6. Tried to deactivate the tenant's sole owner from the Staff page — the backend's real `CannotRemoveLastOwnerError` came back as a 409 and rendered as an error banner instead of a stack trace or a silent no-op; confirmed via the browser's own network log that exactly one `POST /auth/refresh` fired even though two `GET /staff/me` calls raced to it (React StrictMode's double-effect in dev), proving the single-flight refresh dedup in `src/api/client.ts` actually works — a second refresh call would have invalidated the first's already-issued refresh token.
7. Reloaded the page mid-session on `/sales` (not `/`) — session restored silently from the stored refresh token and the correct route rendered, rather than bouncing to the login screen.
8. Registered a second, brand-new tenant and opened Getting started before touching anything — real 0-of-5, 0%. Added a customer, went back — real 1-of-5, 20%, progress bar updated, and that one step flipped from "To do" to "Done" with its link gone, proving the checklist is actually computed live off real account data on every load, not a cached or optimistic client-side guess.
9. Registered a third fresh tenant, opened Settings, saved a real WhatsApp phone number and a real PayFast merchant id — both badges flipped from "Not set" to "Set" and the checklist (a shared read on the same backend state, not a separate flag) moved from 0-of-5 to 2-of-5, 40%. Confirmed the "Connect a Facebook Page" link builds the real `GET /social/:tenantId/connect` URL with this tenant's actual id, and that endpoint really does 302 to Facebook's OAuth dialog (checked with curl, not followed through — no real Meta App credentials are configured in this dev pass, so `client_id` in that redirect is honestly empty).
10. Registered a fourth fresh tenant, opened Growth audit, took the real 40-question instrument (every question answered "2 — Partially in place" through the actual radio inputs) and submitted it. The real backend computed 50.0/100 overall, "Weak" band, and 50% on every section — the exact arithmetic `scoreAudit()` should produce when every raw score is the midpoint (verified by hand: weightPct × 0.5 summed across all seven sections = 50.0, matching what rendered). Confirmed the recommendation engine correctly handled the edge case of no answer actually falling below its weak-answer threshold ("No specific actions surfaced" rendered cleanly, not an error), and that the onboarding checklist's `growth_audit` step flipped to Done afterward.

`npx tsc -b` and `npm run build` both pass clean; `npx oxlint` reports only style warnings (no errors) — see its own output for the one deliberate one (a zero-width space inside `*​/` in a JSDoc comment, so the literal characters `*` `/` don't prematurely close it).

## Honest gaps, not silently deferred

- No frontend test suite yet (no Vitest/RTL) — every claim above is a real, one-time manual verification pass through the browser tool, not a repeatable automated one. The backend's own Jest suite is untouched by anything in this directory.
- Deals, Petty Cash, NPS/Rating, checkout/ITN-log, and the rest of Social Publishing (posting, engagement) have real, gated backend endpoints already (see the main README) but no page here yet — this SPA covers the modules the tenant asked for by name (staff, booking, support), the onboarding checklist with its settings and growth audit, and the core commerce loop (sales/customers/catalog) and the report that ties them together, not the full 19-module surface.
- Only Sales' list endpoint uses the backend's real `?limit=&offset=` pagination; Customers/Catalog/Bookings/Support fetch their full list in one call here, same as their backend endpoints currently return.

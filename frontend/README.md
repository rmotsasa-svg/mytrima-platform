# Mytrima frontend

A real single-page application (React 19 + TypeScript + Vite + React Router) for the Mytrima backend in the parent directory — not a mockup, not a generated stub. It's a separate deployable, calling the API over HTTP through the `CORS_ORIGIN` support the backend added for exactly this (see `../src/common/cors.ts`), the direction the Platform Readiness Assessment's own "What's left" section named as the real product decision still outstanding.

## What's implemented

Every page here calls a real, already-gated backend endpoint — nothing is mocked:

- **Auth** (`src/auth/`) — login, the real first-owner MFA-enrollment walk (start → confirm → log in again with a code, matching `auth.service.ts`'s own documented flow), logout, and silent session restore via the stored refresh token on reload.
- **Snapshot** (`src/pages/SnapshotPage.tsx`) — the Business Snapshot report (`GET /reports/:tenantId/snapshot`).
- **Getting started** (`src/pages/OnboardingPage.tsx`) — the onboarding checklist (`GET /onboarding/:tenantId`), a pure computed status with no write path on the backend (see `onboarding.service.ts`). Only the "add your first customer" step links anywhere in this SPA (`/customers`) — the other four (Growth Audit, WhatsApp phone, Facebook Page, PayFast merchant id) render as plain to-do text rather than linking to a page this SPA doesn't have yet.
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

`npx tsc -b` and `npm run build` both pass clean; `npx oxlint` reports only style warnings (no errors) — see its own output for the one deliberate one (a zero-width space inside `*​/` in a JSDoc comment, so the literal characters `*` `/` don't prematurely close it).

## Honest gaps, not silently deferred

- No frontend test suite yet (no Vitest/RTL) — every claim above is a real, one-time manual verification pass through the browser tool, not a repeatable automated one. The backend's own Jest suite is untouched by anything in this directory.
- Deals, Petty Cash, Growth Audit, NPS/Rating, Payments, and Social Publishing have real, gated backend endpoints already (see the main README) but no page here yet — this SPA covers the modules the tenant asked for by name (staff, booking, support), the onboarding checklist, and the core commerce loop (sales/customers/catalog) and the report that ties them together, not the full 19-module surface.
- Only Sales' list endpoint uses the backend's real `?limit=&offset=` pagination; Customers/Catalog/Bookings/Support fetch their full list in one call here, same as their backend endpoints currently return.

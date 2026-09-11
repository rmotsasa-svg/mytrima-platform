# Mytrima frontend

A real single-page application (React 19 + TypeScript + Vite + React Router) for the Mytrima backend in the parent directory — not a mockup, not a generated stub. It's a separate deployable, calling the API over HTTP through the `CORS_ORIGIN` support the backend added for exactly this (see `../src/common/cors.ts`), the direction the Platform Readiness Assessment's own "What's left" section named as the real product decision still outstanding.

## Brand

Colors, mark, and typography follow the **Mytrima Brand Style Guide v1.0**
(supplied 2026-09-11, superseding an earlier two-lockup draft — "lets
follow this one only"), applied throughout `src/index.css` and
`public/brand/`:

| Token | Hex | Guide's own usage |
|---|---|---|
| `--color-teal` (primary) | `#265757` | Backgrounds, primary icon fill, headlines |
| `--color-mint` (accent) | `#64CAC0` | Secondary contexts, highlights, tagline chips |
| `--color-ink` (black/neutral) | `#100F0D` | Single-color print, stamping, body text |
| — (white) | `#FFFFFF` | Mark on dark backgrounds, negative space |
| `--color-paper` | `#F3F0E8` | Document and page backgrounds |

`--color-ink-muted` and `--color-mint-soft` have no swatch in the guide —
this app's own additions for de-emphasized text and pill/highlight
backgrounds the guide doesn't cover.

Typography: the guide names "Century Gothic Bold" for headlines (its own
specimen discloses using a Liberation Sans substitute, pending a real
license). Century Gothic isn't available here either — **Jost** (Google
Fonts, a geometric sans explicitly modeled on the same Kabel/Century
Gothic-style letterforms) stands in for headings and the wordmark instead,
same disclosed-substitution spirit as the guide's own note. Body copy
stays on IBM Plex Sans — Century-Gothic-style geometric faces have a real
legibility cost at small UI sizes (dense tables, form labels) that the
guide's own headline-sized specimen never has to pay.

The mark itself (a rounded-square teal icon with a white "M") is redrawn
in `public/favicon.svg` and `public/brand/*.svg` from the style guide's
reference image, not extracted from a source vector file — this repo
never received one. Four lockups: `lockup-horizontal-light.svg` (icon +
wordmark + mint tagline chip, for white/light surfaces — the login card),
`lockup-stacked-dark.svg` (centered, on the brand's own teal background),
`lockup-horizontal-dark-compact.svg` (white-on-transparent, no tagline —
the sidebar, which is itself teal), and `favicon.svg` (the icon alone).

Live-verified: registered a tenant, walked the full login → MFA-enrollment
→ dashboard flow with the new lockups rendering at every step (login
card, MFA-enrollment header, sidebar), confirmed both new SVG assets load
`200 OK` in the network log, and found no console errors introduced by the
change.

## What's implemented

Every page here calls a real, already-gated backend endpoint — nothing is mocked:

- **Auth** (`src/auth/`) — login, the real first-owner MFA-enrollment walk (start → confirm → log in again with a code, matching `auth.service.ts`'s own documented flow), logout, and silent session restore via the stored refresh token on reload.
- **Snapshot** (`src/pages/SnapshotPage.tsx`) — the Business Snapshot report (`GET /reports/:tenantId/snapshot`).
- **Business profile** (`src/pages/BusinessProfilePage.tsx`) — description, industry, location, contact email/phone, and a stated business goal (`GET`/`PATCH /auth/tenants/business-profile` and `/auth/tenants/me`). **Real backend gap closed the same day this page was added**: none of these six fields, nor any way to read a tenant's own record back at all, existed anywhere in the schema before — see the main README's own entry on migration 0024. Viewable by any role; editable by owners only. Links out to Catalog for products/services and prices rather than duplicating it.
- **Getting started** (`src/pages/OnboardingPage.tsx`) — the onboarding checklist (`GET /onboarding/:tenantId`), a pure computed status with no write path on the backend (see `onboarding.service.ts`). All five steps now link somewhere real in this SPA.
- **Reports** (`src/pages/ReportsPage.tsx`) — the KPI detail one level below the Business Snapshot's executive summary: `GET /sales/:tenantId/kpis` (sales amount, transactions, avg. transaction value, units, units/transaction, add-on rate, conversion rate, churn rate), `/repeat-rate`, `/lifetime-value`, plus Sales Targets and KPI Benchmarks — both list (`GET`) and set (`POST`, owner/staff only). A period picker (two date inputs) drives KPIs/repeat-rate; lifetime value has no period (see `sale.service.ts`'s own comment on why "lifetime" isn't a date-range concept) and is honestly `null`-rendered ("Not enough data yet") until a customer has a second purchase — a real backend answer, not a fabricated zero.
- **Customer experience** (`src/pages/CustomerExperiencePage.tsx`) — star ratings and NPS surveys, both submitted directly by customers with no Mytrima account (`GET /ratings/:tenantId`, `GET /nps/:tenantId`, plus their `/aggregate` siblings). A moderation queue for ratings: a new rating starts `pending` and does not move the public average until an owner/staff member publishes or hides it (`POST /ratings/:id/moderate`) — the exact split `RatingService.aggregateForTenant()` already enforces. **Note**: the two list endpoints this page depends on did not exist before this page did — see the backend commit right before this one for why and what changed.
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
11. Registered a fifth fresh tenant, submitted two ratings and two NPS responses as an actual unauthenticated customer would (`curl POST /ratings`, `curl POST /nps`), then opened Customer experience as the owner — both showed up with the real data, the rating average correctly excluded the still-`pending` one (0 count until moderated), and the NPS aggregate showed 0 (one promoter score of 9, one detractor score of 3, cancelling out — real math, not a placeholder). Clicked "Publish" on the pending rating from inside the SPA itself (not curl) and watched the average recompute live to 3.5/5 across 2 reviews, with that rating's own status pill and its own "Publish"/"Hide" actions updating in the same render.
12. Registered a sixth fresh tenant, added a catalog item, a customer, and a real sale through the SPA, then opened Reports — **and found a real bug in this page itself**: the KPI tiles all read zero even though the sale existed. Root cause: the period picker's default "To" date, a bare `YYYY-MM-DD`, was sent straight to `GET /sales/:tenantId/kpis`, and the backend's `new Date(periodEnd)` parses a bare date as that day's UTC *midnight* — the very start of today, not its end — so a same-day sale fell after `periodEnd` and silently dropped out of every KPI. Fixed by pushing the "To" date to `23:59:59.999Z` before it ever leaves this page (`endOfDayIso()`), applied consistently to the KPI/repeat-rate query and the Target/Benchmark period fields too. Reloaded — real numbers appeared (`LSL 900,00`, 1 transaction, 2 units). Recorded a second sale for the same customer and confirmed Repeat rate correctly flipped to 100% and Customer Lifetime Value moved off its honest `null`/"not enough data" state to a real (if tiny, given both purchases happened minutes apart in this test) computed value — proving the `null`-vs-real-object branch in the LTV card, and the frontend type for it, both actually work (fixed the type from a plain `CustomerLifetimeValueResult` to `CustomerLifetimeValueResult | null` in the same pass, since it had been silently wrong). Also set a real Sales Target and a real KPI Benchmark through their own forms and confirmed both listed back correctly.

13. Registered a seventh fresh tenant and opened Business profile — real, correct empty state ("Not set" on all six fields, "Nothing filled in yet"). Filled in and saved a real description, industry, location, contact email, contact phone, and business goal through the actual form; confirmed `PATCH /auth/tenants/business-profile` returned 200 and the page redisplayed every real saved value on `GET /auth/tenants/me`, not a client-side echo. Then opened Getting started and confirmed the checklist — now 6 steps, not 5 — showed `1 of 6, 17%` with "Tell us about your business" flipped to Done, reading the exact same backend state the profile page just wrote.

`npx tsc -b` and `npm run build` both pass clean; `npx oxlint` reports only style warnings (no errors) — see its own output for the one deliberate one (a zero-width space inside `*​/` in a JSDoc comment, so the literal characters `*` `/` don't prematurely close it).

## App shell resilience — 2026-09-11

Three fixes closing findings from the SPA Readiness Assessment:

- **`src/components/ErrorBoundary.tsx`** — wraps `<Outlet/>` in `Layout.tsx`, keyed on the route so a crash resets automatically on navigation. An uncaught exception in one page's content now shows a real fallback (error message, "Try again", "Go to Snapshot") with the sidebar still intact and usable, instead of blanking the whole app.
- **Route-level code splitting** — every page in `App.tsx` is `lazy()`-loaded; `<Suspense>` lives inside `Layout.tsx` around `<Outlet/>` so only the content area shows a loading state. Real measured result: one 331 KB bundle became a 277 KB shared shell plus 12 separate 2–10 KB per-page chunks.
- **A real mobile nav** — the old horizontally-scrolling sidebar (which overflowed with no scroll affordance, per the assessment) is now a proper collapsed drawer below 760px: hamburger toggle, tap-to-close scrim, closes itself on navigation. Building it live at 375×812 surfaced two further real CSS bugs (a wide table forcing the whole mobile grid track past the viewport width; `align-content`'s default stretch behavior leaving a dead gap under the collapsed header) — both found by direct `getBoundingClientRect()` inspection and fixed in `Layout.css`, not guessed from the stylesheet alone.

## Website analytics — 2026-09-11

`src/pages/WebsiteAnalyticsPage.tsx`, closing the gap the tenant asked
about directly (see the main README's own "Website analytics" section for
the full backend design and its privacy reasoning — this section covers
just the SPA side). A "Connect your website" card shows the exact
tenant-specific `<script>` tag to paste onto their own site, with a real
copy-to-clipboard button (a plain `document.execCommand`-free
`navigator.clipboard.writeText()`, with a graceful select-and-copy-by-hand
fallback if the browser denies clipboard access rather than a silent
no-op), followed by a period picker (reusing the exact UTC-end-of-day fix
`ReportsPage.tsx`'s own `endOfDayIso()` already proved necessary), summary
stat tiles, a visits-by-day bar chart, top-pages/top-referrers tables, and
a device breakdown. An honest, disclosed empty state ("No visits recorded
yet for this period") renders when a tenant hasn't embedded the snippet
yet, rather than a fabricated zero-value chart. Code-split via `lazy()`
and added to the nav, same as every page since the App shell resilience
pass below.

Live-verified against a real running backend and this SPA's real dev
server: logged in as the demo tenant, confirmed the page rendered the
correct real `<script>` tag with this tenant's actual id and the backend's
actual origin baked in, sent real beacons via curl (mobile/desktop/tablet
User-Agents, a foreign `Origin` header, one repeated `sessionId` to prove
session-vs-pageview counting) directly against the running backend, then
reloaded the page and confirmed every number rendered — 6 total page
views, 5 sessions, 1.2 views/session, the correct top-path counts
(`/pricing` × 4, `/` × 1, `/about` × 1), the correct referrer breakdown
(`google.com` × 3, "Direct" × 2, `facebook.com` × 1), and the correct
device split (50% mobile, 33% desktop, 17% tablet) — matched the real
numbers the API itself returned via a separate `curl GET
/analytics/:tenantId/summary` call with the same access token, not just
"the page didn't crash." Also confirmed the CORS gap this feature depends
on: the backend was left running with `CORS_ORIGIN` set only to this SPA's
own origin, and the beacon's `collect` calls (a completely different,
unenumerable tenant-website origin) still succeeded because of the
separate scoped CORS middleware in `main.ts` — proving the two CORS paths
are genuinely independent, not one accidentally covering for the other.

## Self-serve signup + email verification — 2026-09-11

Two new pieces, both reachable without a session (checked in `App.tsx`'s
`AuthGate` before the normal logged-in/logged-out branching — see that
file's own comment):

- **`src/auth/VerifyEmailPage.tsx`** (`/verify-email?token=...`) — the
  landing spot for the real link a self-serve owner is emailed at signup
  (see the main README's own "Self-serve signup" section for the backend
  side). Idempotent by design, matching `AuthService.verifyEmailAddress()`:
  a stale tab or an email client's own link-prefetch re-hitting this page
  succeeds the same way a fresh click does.
- **`src/auth/LoginPage.tsx`** now distinguishes `EmailNotVerifiedError`
  specifically (via `ApiError.body.error`, not just its message text) and
  offers a "Send a new link" resend button in place, rather than a dead-end
  error banner.

Live-verified in a real browser against a real running backend: signed up
via curl, confirmed a plain login attempt showed the new "verify your
email" banner with a working resend button (confirmed the resend actually
reached the backend by checking its own console log for a second, fresh
verification link), then opened the real emailed link at `/verify-email`
and confirmed it rendered "Your email is verified. You can now sign in."
with a working link back to the login form.

## `landing/` — a separate public site, not a route here — 2026-09-11

The tenant asked whether a landing page alongside this SPA would help.
Scoped and built as `landing/`, a **separate** Vite+React project (own
`package.json`, dev port 5174) — not a new route in this app's own
router. Real reasons: this SPA is client-rendered behind auth (every
route in `App.tsx` assumes a session, and client-rendered content is
weaker for SEO than what a public marketing page wants); the two have
completely different change cadences and can be deployed to different
hosts independently. It reuses this project's real brand tokens (colors,
Jost/IBM Plex Sans pairing) and logo SVGs — copied into `landing/src/`
and `landing/public/brand/`, not imported across the two projects, with
the hand-kept-in-sync risk disclosed directly in
`landing/src/tokens.css`'s own comment rather than hidden behind a
shared-package abstraction two small files don't yet justify. See
`landing/README.md` for that project's own detail.

## Honest gaps, not silently deferred

- No frontend test suite yet (no Vitest/RTL) — every claim above is a real, one-time manual verification pass through the browser tool, not a repeatable automated one. The backend's own Jest suite is untouched by anything in this directory.
- Deals, Petty Cash, checkout/ITN-log, and the rest of Social Publishing (posting, engagement) have real, gated backend endpoints already (see the main README) but no page here yet — this SPA covers the modules the tenant asked for by name (staff, booking, support), the onboarding checklist with its settings and growth audit, customer experience (ratings/NPS), sales KPI reporting (targets/benchmarks), website analytics, and the core commerce loop (sales/customers/catalog) and the executive report that ties them together, not the full 19-module surface.
- Only Sales' list endpoint uses the backend's real `?limit=&offset=` pagination; Customers/Catalog/Bookings/Support fetch their full list in one call here, same as their backend endpoints currently return.

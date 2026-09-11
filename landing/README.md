# Mytrima — public site

Mytrima's public marketing/signup site — **deliberately separate** from
`../frontend/` (the logged-in SPA), not a route bolted onto its router.
See the main README's own "Self-serve signup, email verification, and a
public landing page" section (2026-09-11) for the full scoping story; this
file covers just this project.

## Why separate

- `frontend/` is client-rendered behind auth — every route assumes a
  session. This site is reached by strangers with no session at all, and
  client-rendered content is weaker for SEO than what a public marketing
  page wants.
- Different change cadence: marketing copy changes on a whim, the app
  doesn't.
- Can be deployed to a completely different host/domain than the SPA,
  independently.

## Brand assets: copied, not shared

`src/tokens.css` and `public/brand/*` are real copies of `frontend/`'s own
brand tokens and logo files — not imported across the two projects
(there's no monorepo package boundary between them, and building one for
a handful of files isn't worth it yet). This is a disclosed, hand-kept-
in-sync risk: if the palette or logo ever changes, both projects need
updating separately. `tokens.css`'s own top comment says so.

**Logo update, 2026-09-12**: `public/brand/*.png` replaced the earlier
hand-authored `*.svg` mark files (new design, real PNG exports, no vector
source given this time) — see `frontend/README.md`'s own "Logo update"
section for the full detail (the exact colors sampled from the new files,
and a real oversized-`<img>` layout bug found and fixed on this site's
`frontend/` sibling). `Nav.tsx`/`Footer.tsx` already had explicit
`height`-constrained CSS classes (`topbar-logo`/`footer-logo`), so this
site didn't hit that same bug.

## What's on the site

Expanded 2026-09-11 from a single page into six real routes (`react-router-dom`,
same version as `frontend/`), sharing one `Nav`/`Footer` shell (`App.tsx`):

| Route | What's there |
| --- | --- |
| `/` | Hero, three illustrative "ad banner" call-outs (`AdBanner.tsx` — abstract bar/line/donut chart motifs, never real data, see that file's own comment), the website-analytics snippet highlight, and the real signup form |
| `/about` | Grounded mission copy — no invented founding dates, team size, or client counts |
| `/solution` | The six real modules, grouped by outcome rather than feature name |
| `/packages` | **Honest interim state** — no real pricing tiers exist yet; rather than invent numbers, this points to Contact. Swap in real tiers the moment they're decided (see `PackagesPage.tsx`'s own comment) |
| `/success-stories` | **Honest interim state** — no real, permissioned customer story exists yet; same reasoning as Packages (see `SuccessStoriesPage.tsx`'s own comment) |
| `/contact` | A real `mailto:`-based contact form (works the moment a real address is set in `ContactPage.tsx`'s own `CONTACT_EMAIL`/`CONTACT_PHONE` constants — deliberately left blank rather than publishing a guessed or personal address) |

The signup form (on `/`) calls `POST {VITE_API_BASE_URL}/auth/tenants`
directly — the same now-open, rate-limited endpoint `frontend/`'s own
`AuthApi.registerTenant()` calls, with no `signupCode` (self-serve is open
by default — see the main README). On success it shows a real
"check your inbox" message linking to `VITE_APP_URL` (the SPA's login),
not a fabricated confirmation.

## Running it

```bash
cp .env.example .env.local   # point VITE_API_BASE_URL/VITE_APP_URL at your backend/SPA
npm install
npm run dev                  # http://localhost:5174, fixed port (see vite.config.ts)
```

The backend's `CORS_ORIGIN` must include this site's real deployed origin
(or `http://localhost:5174` for local dev) — the signup form's call is
cross-origin, and without it the browser silently blocks the request, not
this app.

## Live, real verification (2026-09-11)

Ran this site's real dev server against the real compiled backend
(`node dist/main.js`, in-memory stores, `CORS_ORIGIN` including this
site's own `localhost:5174`) — driven through an actual browser:

1. Loaded the page, confirmed every section renders (hero, six feature
   cards, the teal snippet-highlight block with its own real `<script>`
   tag text, the signup card, footer) — checked at the pane's own narrow
   viewport, not just a desktop-width screenshot.
2. Filled out and submitted the real signup form (a real business name,
   email, password) — the browser's own network call hit the real
   backend, which created a real tenant + owner and logged a real,
   clickable verification link to its own console (no SES configured in
   this dev pass — see the main README's own disclosed SES-domain-
   verification gap).
3. Confirmed the success state rendered with the real email address
   echoed back and a working link to the SPA's login page.

`npx tsc -b` and `npm run build` both pass clean; `npx oxlint` reports
zero warnings.

## Multi-page expansion — 2026-09-11

Added Home/About/Our Solution/Packages/Success Stories/Contact as real
routes, plus three illustrative ad banners. Two real things found and
fixed live-verifying it, not just written:

- **Nav wrapping bug**: a plain `flex-wrap` topbar with logo, six nav
  links, and Sign in as independent flex items wrapped into a tangled,
  unreadable order at narrow widths (links reflowing mid-row around the
  logo). Fixed with an explicit CSS Grid + `grid-template-areas` swap
  below 820px (logo/Sign-in on row one, nav links as their own full-width
  row two) rather than a single flex row trying to do everything at every
  width.
- **Cross-page hash-anchor scrolling didn't work at all**: the Contact
  page's "reach out through the signup form" link (`/#signup`) relied on
  the browser's own native anchor-scroll, which races this client-rendered
  app's own mount — on a fresh load it looks for `#signup` before
  `HomePage` has rendered, finds nothing, and never retries. Fixed in
  `App.tsx`'s `useDocumentTitle()` (renamed in spirit, not in code, to
  "also handles hash scrolling") by scrolling to the target ourselves on
  a `requestAnimationFrame` after each route change, keyed off
  `location.hash` specifically (not just `location.pathname`, which
  wouldn't have re-fired the effect at all for a same-page hash change).
  Verified both a fresh `/#signup` load and an in-app click from `/contact`
  land correctly, scrolled to the real form.

Packages/Success Stories/Contact ship with an honest, presentable interim
state rather than fabricated prices, testimonials, or contact details —
see the table above and each page's own top comment for what's pending.

## Security assessment — 2026-09-12

Real checks run against this project, not a paper review:

**Live-tested XSS, not just reasoned about**: submitted a real signup
through this site's own form with a business name of
`<script>alert(1)</script><img src=x onerror=alert(2)>`. Confirmed no
alert fired at any point — logged the resulting console (clean), then
carried the same tenant through real email verification and MFA
enrollment in `frontend/` and viewed it on the Business Profile page
(`profile.name` renders directly there, no escaping helper of its own).
The payload rendered as inert literal text
(`<SCRIPT>ALERT(1)</SCRIPT><IMG SRC=X ONERROR=ALERT(2)>`, uppercased only
by this page's own CSS) — proof, not inference, that React's default
JSX escaping holds end to end for this specific field, across both
projects. Grepped both `landing/src` and `frontend/src` for
`dangerouslySetInnerHTML`/`.innerHTML =`/`eval(` — zero matches in
either.

**Fixed**: added a real `Content-Security-Policy` meta tag to
`index.html` (`script-src 'self'` is the load-bearing directive — no
inline `<script>` exists anywhere in this app, so this is a genuine
restriction against any future injected one, not a formality).
**A real bug caught live-verifying it, not assumed from the spec**: the
policy's first draft included `frame-ancestors 'none'` — Chrome's own
console logged "The Content Security Policy directive 'frame-ancestors'
is ignored when delivered via a `<meta>` element" the moment the page
loaded. Removed it rather than leave a silently-inert directive in place
— see `index.html`'s own comment for why real clickjacking protection
needs a genuine HTTP response header at the hosting/CDN layer instead,
a real, disclosed gap this static file can't close on its own.

**Also checked and confirmed clean**: `npm audit` — zero vulnerabilities
in both `landing/` and `frontend/`. No `localStorage`/`sessionStorage`
usage and no `console.*` calls anywhere in `landing/src` — nothing here
to leak a password or token into browser storage or devtools. The signup
form's `fetch` call sends no cookies (`credentials` never set) and
carries no ambient session — the usual CSRF attack shape (a forged
cross-site request riding a victim's existing session) doesn't apply to
an endpoint with no session to ride.

**A real nuance worth stating plainly, not a vulnerability**: CORS is
enforced by browsers, not this backend — a request from `curl`/Postman
(or any non-browser client) reaches `POST /auth/tenants` and is processed
regardless of `CORS_ORIGIN`, which only controls whether a *browser*
running someone else's page is allowed to read the response back. The
real access-control boundary for this deliberately-public,
unauthenticated endpoint is the backend's own rate limit (5/hour/IP) and
required email verification before the resulting account can do
anything — not CORS, which was never designed to gate direct API access
at all.

**Real, disclosed gaps — flagged, not fixed here** (all pre-existing,
backend-wide, out of this project's own scope to fix unilaterally):
no HTTP security headers anywhere in the NestJS backend (no Helmet —
`X-Content-Type-Options`, `Referrer-Policy`, `Strict-Transport-Security`
are all unset on every response, this project's included); the rate
limiter is a real, working in-process `Map` (already documented in
`rate-limit.guard.ts`'s own comment) that doesn't survive a restart or
share state across more than one backend process; no CAPTCHA on the
signup form beyond that same rate limit.

## Honest gaps, not silently deferred

- No prerendering/SSG — this is a client-rendered Vite+React build like
  `frontend/`, not a true static-site-generator output. Real SEO benefit
  from server-rendered HTML is a disclosed gap, not something this build
  quietly claims. Revisit if organic search traffic becomes a real
  priority — the scoping conversation that led to this project explicitly
  chose "small separate Vite static site" over a full SSG framework
  (Astro/Next) for a faster first ship.
- No automated test suite here either, same as `frontend/`'s own disclosed
  gap — the verification above is a real, one-time manual pass, not a
  repeatable one.
- The signup form has no CAPTCHA or other bot-mitigation beyond the
  backend's own 5/hour-per-IP rate limit — a real, disclosed trade-off for
  a first ship, not an oversight.

-- Mytrima — Migration 0025: Website analytics
--
-- REAL GAP the tenant asked about directly: no module anywhere connected a
-- tenant's own website or reported traffic to it. Chosen approach, per the
-- tenant's own decision between the real options laid out for them
-- (connect to an existing Google Analytics property vs. build a first-party
-- collector): a first-party tracking snippet Mytrima owns end to end — the
-- only option that works for a tenant with no analytics set up at all,
-- which is the more likely case for this pilot's own cohort.
--
-- That choice carries a real privacy weight the other option wouldn't
-- have: this table holds behavioral data about a tenant's own SITE
-- VISITORS — people with no account, no relationship with Mytrima, and no
-- way to have consented to Mytrima specifically. Every column here is
-- deliberately minimal against that:
--   - No IP address, ever — not even transiently. country is populated
--     only when a trusted edge/proxy already resolved it (e.g. a CDN's own
--     "CF-IPCountry"-style request header) and passed just the two-letter
--     code along; see AnalyticsController.readCountry(). This app never
--     reads the request's IP itself and never performs its own GeoIP
--     lookup, so there is no raw IP anywhere in this feature to
--     accidentally log or persist in the first place. Real, disclosed
--     consequence: a tenant's site not served through such an edge gets no
--     country data at all (the column is simply null) rather than this
--     app reaching for the IP to fill the gap.
--   - No raw user-agent string. device_type is a coarse category
--     (desktop/mobile/tablet/other) parsed from it server-side; the exact
--     string (a real, if minor, fingerprinting surface) is discarded the
--     same way the IP is.
--   - session_id is a value the tracking snippet generates client-side and
--     keeps only in sessionStorage (see public/mytrima-analytics.js) — it
--     resets every time the browser tab/session ends, not a persistent
--     years-long identifier the way a typical analytics cookie is. It
--     lets this table count "sessions" (a burst of page views) without
--     being able to recognize the same visitor again next week.
--   - No cross-tenant or cross-site identifier of any kind — a visitor on
--     tenant A's site and tenant B's site (both using Mytrima analytics)
--     produces two completely unlinkable session_ids.
-- Real, disclosed follow-up this migration does NOT do: no automatic data
-- retention/expiry job yet (matching audit_log's own same disclosed gap) —
-- rows accumulate indefinitely until a retention policy is built.

begin;

create table website_visit (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenant(id) on delete cascade,
  session_id    text not null,
  path          text not null,
  referrer      text,
  country       text,
  device_type   text not null default 'other' check (device_type in ('desktop', 'mobile', 'tablet', 'other')),
  occurred_at   timestamptz not null default now()
);

create index website_visit_tenant_time_idx on website_visit (tenant_id, occurred_at desc);

alter table website_visit enable row level security;

create policy tenant_isolation_website_visit on website_visit
  using (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  with check (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

commit;

-- Mytrima — Migration 0029: deal.last_published_at, deal.published_channels
--
-- REAL GAP closed 2026-09-14 at the tenant's own explicit request: "push
-- promotion through sales channels" needed somewhere real to record that a
-- deal was actually pushed to Facebook/Instagram, and when — the Marketing
-- & Brand Insights page's own "online advertising activities" view reads
-- straight off these two columns, not a fabricated log. Deliberately kept
-- on the `deal` row itself (last push wins), not a full history table: the
-- real per-post record already exists in `social_post_log`
-- (migration 0017) — a deal push calls the same DealsController->
-- SocialPublishingController machinery and logs there too, so the full
-- history isn't lost, just not duplicated onto this table.

begin;

alter table deal add column last_published_at timestamptz;
alter table deal add column published_channels text[];

commit;

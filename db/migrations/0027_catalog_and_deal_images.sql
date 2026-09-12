-- Mytrima — Migration 0027: catalog_item.image_url, deal.ad_image_url
--
-- REAL GAP closed 2026-09-12, at the tenant's own explicit request: Catalog
-- had no way to attach a real product/service photo, and Deals had no way
-- to attach a real ad/promotional creative. Both are just a nullable path
-- to a file under local disk storage (src/common/uploads.ts) — the tenant's
-- own explicit choice over S3/base64, made knowing local disk doesn't
-- survive a redeploy on ephemeral hosting. Storing a URL string here, not
-- the image bytes, keeps this migration trivial regardless of which
-- storage backend is behind it later.

begin;

alter table catalog_item add column image_url text;
alter table deal add column ad_image_url text;

commit;

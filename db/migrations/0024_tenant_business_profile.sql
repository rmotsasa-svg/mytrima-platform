-- Mytrima — Migration 0024: Tenant business profile
--
-- REAL GAP found 2026-09-11 answering the tenant's own question ("business
-- set up page where is it, where tenant upload business info — business
-- description, contacts, location, industry, business goal"): the `tenant`
-- table had id/name/country/status plus the two later-added integration
-- fields (notification_phone_e164, payfast_merchant_id) — nothing else.
-- There has never been anywhere in this schema for a tenant's own business
-- identity: what the business does, where it is, how a customer or partner
-- reaches it, what sector it's in, or what growth outcome it's chasing.
-- Products/services with prices already have a real home (catalog_item,
-- migration 0002) — this migration is everything else that page needs.
--
-- All six columns nullable, same pattern as notification_phone_e164/
-- payfast_merchant_id: a tenant that hasn't filled one in yet is a real,
-- expected state (especially right after signup), not an error.
-- contact_email/contact_phone are deliberately separate from
-- notification_phone_e164 — that one is where WhatsApp automation sends
-- alerts (see migration 0014's own comment); these two are the business's
-- own public-facing contact details, a different concept that just happens
-- to also be a phone number.

begin;

alter table tenant add column description text;
alter table tenant add column industry text;
alter table tenant add column location text;
alter table tenant add column contact_email text;
alter table tenant add column contact_phone text;
alter table tenant add column business_goal text;

commit;

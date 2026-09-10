-- Mytrima — Migration 0013: Instagram account on social_connection
-- Master Plan §6's Social Publishing Service was always "Facebook AND
-- Instagram" — only Facebook existed through migration 0012. Instagram
-- publishing uses the same Facebook Page access token (no separate
-- credential), so this just records which Instagram professional account
-- (if any) is linked to the already-connected Page — resolved once at
-- OAuth-callback time via GET /{page-id}?fields=instagram_business_account
-- (see meta-oauth.service.ts's handleCallback()).
--
-- Nullable on purpose: a Page with no linked Instagram account is the
-- common, expected case, not an error condition (see meta.service.ts's own
-- comment on resolveInstagramAccount()).

begin;

alter table social_connection add column instagram_account_id text;

commit;

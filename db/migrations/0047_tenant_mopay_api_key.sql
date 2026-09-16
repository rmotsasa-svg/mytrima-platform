-- Mytrima — Migration 0047: tenant MoPay API key
--
-- B1 of "ACTION PROPOSED ADDITIONS IN PRIORITY ORDER" — MoPay as a real
-- second checkout gateway alongside PayFast. Unlike PayFast (one Mytrima-
-- owned merchant account, splitting a payment's own tenant share via
-- real-time Split Payments — see payfast.service.ts's own top comment),
-- MoPay's documented API has no split-payment concept: each tenant needs
-- their own MoPay account and their own API key, used directly for that
-- tenant's own checkout sessions. See tenant.service.ts's own
-- mopayApiKey comment.

begin;

alter table tenant add column mopay_api_key text;

commit;

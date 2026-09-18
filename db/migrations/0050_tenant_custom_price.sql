-- Mytrima — Migration 0050: per-tenant custom subscription price
--
-- The tenant's own explicit request: "the administrator should be able to
-- set subscription tiers on their own however they want" — clarified to
-- mean an arbitrary price per tenant, not a fifth/custom TIER name (that
-- would mean loosening subscription_tier's own check constraint and every
-- checkout-math lookup keyed on it, real scope beyond what the request
-- actually needs). This column is a real, admin-only override: when set,
-- it replaces TIER_PRICING_ZAR[tier] for THIS tenant's next charge —
-- whichever of the 4 real tiers they're on — instead of the standard
-- published price. Null (the default) means "use the standard price,"
-- the same as every tenant today. Never touched by self-service
-- checkout (SubscriptionService.selectTier()) — only by an admin, via
-- AdminTenantService.setCustomPrice().
--
-- No check constraint on the value itself beyond >= 0 (below) — an admin
-- negotiating a real deal is trusted with the actual number, same "don't
-- invent validation a real source doesn't give" discipline as
-- TenantService's own setMopayApiKey()/E164_PATTERN comments.

begin;

alter table tenant add column custom_price_zar numeric check (custom_price_zar >= 0);

commit;

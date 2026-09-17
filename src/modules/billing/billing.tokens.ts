export const SUBSCRIPTION_PAYMENT_STORE = Symbol("SUBSCRIPTION_PAYMENT_STORE");

/** Mytrima's OWN MoPay account, used only to COLLECT a tenant's real
 * subscription fee — the reverse direction from payments.tokens.ts's
 * PAYFAST_MERCHANT_ID/KEY (Mytrima collecting on a tenant's behalf) and
 * from tenant.mopayApiKey (a tenant's own account, for their own
 * customer checkouts — see tenant.service.ts's own comment). No dev-only
 * fallback, same reasoning as PAYFAST_MERCHANT_ID's own comment: an
 * unset key just fails checkout creation outright, never "works
 * insecurely." */
export const MOPAY_PLATFORM_API_KEY = Symbol("MOPAY_PLATFORM_API_KEY");

/**
 * Fixed, well-known UUID for the single demo tenant + demo user the
 * dashboard (GET /) logs in as. A real UUID — not the earlier "t1"
 * placeholder — because it has to satisfy a real foreign-key constraint
 * once DATABASE_URL is set: an arbitrary string worked fine against the
 * in-memory stores (no such constraint exists there), but would silently
 * fail against Postgres with app_user_tenant_id_fkey. Using the same real
 * ID in both modes means nothing about the demo login depends on which
 * store backend is active.
 */
export const DEMO_TENANT_ID = "00000000-0000-0000-0000-000000000001";

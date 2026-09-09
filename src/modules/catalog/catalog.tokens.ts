/** NestJS DI token for the CatalogItemStore interface — see consent.tokens.ts
 * for why an interface-typed dependency needs an explicit token. */
export const CATALOG_ITEM_STORE = Symbol("CATALOG_ITEM_STORE");

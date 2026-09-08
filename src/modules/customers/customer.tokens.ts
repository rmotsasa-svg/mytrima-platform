/** NestJS DI token for the CustomerStore interface — see consent.tokens.ts for
 * why an interface-typed dependency needs an explicit token. */
export const CUSTOMER_STORE = Symbol("CUSTOMER_STORE");

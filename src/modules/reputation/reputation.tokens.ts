/** NestJS DI token for the RatingStore interface — see consent.tokens.ts for
 * why an interface-typed dependency needs an explicit token. */
export const RATING_STORE = Symbol("RATING_STORE");

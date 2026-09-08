/** NestJS DI token for the NpsResponseStore interface — see
 * consent.tokens.ts for why an interface-typed dependency needs an explicit
 * token. */
export const NPS_RESPONSE_STORE = Symbol("NPS_RESPONSE_STORE");

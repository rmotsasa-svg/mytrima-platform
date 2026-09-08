/** NestJS DI token for the ConsentStore interface — TypeScript interfaces
 * have no runtime representation, so an interface-typed dependency needs an
 * explicit token to be injectable. See consent.module.ts for the binding. */
export const CONSENT_STORE = Symbol("CONSENT_STORE");

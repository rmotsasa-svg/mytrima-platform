/**
 * REMOVED FROM SCOPE — Master Plan v1.2 (Section 8/9 changelog v1.1 → v1.2).
 *
 * Hellopeter's API was confirmed to exist, but the commercial terms for a
 * platform integrating on behalf of many tenants — rather than a single
 * business managing its own reviews — were never resolved, and staying
 * blocked on that reseller/partner negotiation was a real risk to the pilot
 * timeline. Decision: build an in-house Rating Module instead, removing the
 * vendor dependency entirely rather than leaving this as a permanent
 * "needs verification" line item.
 *
 * Replacement: src/modules/reputation/rating.service.ts (9/9 tests passing).
 *
 * This file is kept only so the reasoning behind removing a previously-
 * planned integration is documented, not silently dropped (Master Plan
 * Section 9). It can be deleted once nothing references it — Windows
 * Controlled Folder Access blocked this session from deleting it directly;
 * `rm` or your editor's delete will work fine for you.
 */
export {};

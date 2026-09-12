/**
 * The one real source of truth for what Mytrima charges its own tenants —
 * real prices given by the tenant 2026-09-12, currently ALSO duplicated in
 * landing/src/pages/PackagesPage.tsx (the public pricing page a prospect
 * sees before ever creating an account). Kept in sync by hand, same
 * disclosed risk as landing/src/tokens.css's own brand-token duplication —
 * there's no shared package boundary between this backend and that
 * separate frontend project to import across. If these two ever drift,
 * this file is the one that actually gets billed; the landing page is
 * marketing copy.
 *
 * `priceLSL: null` means "not self-serve" — Enterprise has no fixed price
 * ("Request a quote" on the landing page) and is deliberately excluded
 * from BillingService.startCheckout()'s own package validation, not
 * silently permitted through with a fabricated price.
 */
export interface PackageDefinition {
  name: string;
  priceLSL: number | null;
}

export const PACKAGES: readonly PackageDefinition[] = [
  { name: "Start Free", priceLSL: 0 },
  { name: "Pro Plus", priceLSL: 350 },
  { name: "Growth Plan", priceLSL: 420 },
  { name: "Growth Partner", priceLSL: 600 },
  { name: "Enterprise", priceLSL: null },
];

export function findPackage(name: string): PackageDefinition | undefined {
  return PACKAGES.find((p) => p.name === name);
}

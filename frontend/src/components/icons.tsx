/**
 * Small, self-contained line-icon set for the sidebar nav (2026-09-15, at
 * the tenant's own request — "add icons on sidebar nav links"). Hand-drawn
 * inline SVG, not a library import: every other icon-shaped thing in this
 * app so far is a real PNG (the brand mark) or a Unicode glyph (the ★
 * rating stars), and pulling in an icon package for ~20 sidebar glyphs
 * would be a lot of dependency weight for something this small and easy to
 * keep consistent by hand. Every icon shares the same 20x20 stroke
 * treatment so the set reads as one family rather than twenty unrelated
 * pictograms.
 */
import type { ReactElement, SVGProps } from "react";

export type NavIconName =
  | "dashboard"
  | "audit"
  | "goals"
  | "actions"
  | "triggers"
  | "crm"
  | "customers"
  | "retention"
  | "pos"
  | "catalog"
  | "deals"
  | "quotations"
  | "marketing"
  | "analytics"
  | "experience"
  | "bookings"
  | "staff"
  | "support"
  | "reports"
  | "business"
  | "settings"
  | "chevron"
  | "account";

const PATHS: Record<NavIconName, ReactElement> = {
  dashboard: (
    <>
      <rect x="3" y="3" width="6.5" height="6.5" rx="1.2" />
      <rect x="10.5" y="3" width="6.5" height="6.5" rx="1.2" />
      <rect x="3" y="10.5" width="6.5" height="6.5" rx="1.2" />
      <rect x="10.5" y="10.5" width="6.5" height="6.5" rx="1.2" />
    </>
  ),
  audit: (
    <>
      <circle cx="8.5" cy="8.5" r="5.5" />
      <line x1="16.5" y1="16.5" x2="12.6" y2="12.6" />
    </>
  ),
  goals: (
    <>
      <circle cx="10" cy="10" r="7" />
      <circle cx="10" cy="10" r="3.8" />
      <circle cx="10" cy="10" r="0.9" fill="currentColor" stroke="none" />
    </>
  ),
  actions: (
    <>
      <path d="M4 6h9" />
      <path d="M4 10h6" />
      <path d="M4 14h4" />
      <path d="M13.5 12.5l1.6 1.6 3-3.4" />
    </>
  ),
  triggers: <path d="M10 3.3c-2.3 0-4 1.9-4 4.4v2.4c0 1-.4 2-1.1 2.7L4 13.7h12l-.9-.9a3.8 3.8 0 0 1-1.1-2.7V7.7c0-2.5-1.7-4.4-4-4.4zM8.3 15.8a1.9 1.9 0 0 0 3.4 0" />,
  crm: (
    <>
      <circle cx="7" cy="6.5" r="2.5" />
      <circle cx="14" cy="7.5" r="2" />
      <path d="M2.5 16.5c0-2.8 2-4.5 4.5-4.5s4.5 1.7 4.5 4.5" />
      <path d="M12 12.7c1.9.3 3.2 1.7 3.2 3.8" />
    </>
  ),
  customers: (
    <>
      <circle cx="10" cy="6.5" r="3.2" />
      <path d="M3.6 16.5c0-3.3 2.6-5.4 6.4-5.4s6.4 2.1 6.4 5.4" />
    </>
  ),
  retention: (
    <>
      <path d="M15.5 6.5A6 6 0 1 0 16.5 10" />
      <path d="M15.5 3v4h-4" />
    </>
  ),
  pos: (
    <>
      <path d="M3 5h1.7l1.3 8.2a1.4 1.4 0 0 0 1.4 1.2h7a1.4 1.4 0 0 0 1.4-1.1L17 7H5.3" />
      <circle cx="8" cy="17" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="14" cy="17" r="1.1" fill="currentColor" stroke="none" />
    </>
  ),
  catalog: (
    <>
      <path d="M3 3.8h6.2L17 11.6l-6.4 6.4L2.8 10.2z" />
      <circle cx="7" cy="7" r="1.1" fill="currentColor" stroke="none" />
    </>
  ),
  deals: (
    <>
      <circle cx="6.3" cy="6.3" r="2.1" />
      <circle cx="13.7" cy="13.7" r="2.1" />
      <line x1="14.5" y1="5.5" x2="5.5" y2="14.5" />
    </>
  ),
  quotations: (
    <>
      <path d="M5.5 2.8h6l3 3v10.6a1 1 0 0 1-1 1h-8a1 1 0 0 1-1-1V3.8a1 1 0 0 1 1-1z" />
      <path d="M11.5 2.8v3h3" />
      <line x1="6.8" y1="10" x2="13.2" y2="10" />
      <line x1="6.8" y1="12.8" x2="10.5" y2="12.8" />
    </>
  ),
  marketing: (
    <>
      <path d="M3 8.5v3l10.5 3.5V5z" />
      <path d="M16.8 7a3.2 3.2 0 0 1 0 6" />
      <path d="M6 11.5v3a1.4 1.4 0 0 0 2.8 0v-2.1" />
    </>
  ),
  analytics: (
    <>
      <line x1="4" y1="16.5" x2="16.5" y2="16.5" />
      <rect x="5" y="10.5" width="2.8" height="6" />
      <rect x="9.5" y="6.5" width="2.8" height="10" />
      <rect x="14" y="3.5" width="2.8" height="13" />
    </>
  ),
  experience: <path d="M10 3.2l2.1 4.3 4.7.7-3.4 3.3.8 4.6L10 13.8l-4.2 2.3.8-4.6-3.4-3.3 4.7-.7z" />,
  bookings: (
    <>
      <rect x="3.2" y="4.2" width="13.6" height="12" rx="1.4" />
      <line x1="3.2" y1="8" x2="16.8" y2="8" />
      <line x1="6.6" y1="2.7" x2="6.6" y2="5.5" />
      <line x1="13.4" y1="2.7" x2="13.4" y2="5.5" />
    </>
  ),
  staff: (
    <>
      <rect x="3" y="4" width="14" height="12" rx="1.6" />
      <circle cx="7.3" cy="9" r="1.7" />
      <path d="M4.7 13.2c0-1.5 1.1-2.4 2.6-2.4s2.6.9 2.6 2.4" />
      <line x1="12" y1="8.3" x2="14.6" y2="8.3" />
      <line x1="12" y1="11" x2="14.6" y2="11" />
    </>
  ),
  support: (
    <>
      <path d="M4 10.5a6 6 0 0 1 12 0" />
      <rect x="3" y="10.5" width="3" height="4" rx="1" />
      <rect x="14" y="10.5" width="3" height="4" rx="1" />
      <path d="M15 14.5v.6a2.4 2.4 0 0 1-2.4 2.4h-1.8" />
    </>
  ),
  reports: (
    <>
      <path d="M5.5 2.8h6l3 3v10.6a1 1 0 0 1-1 1h-8a1 1 0 0 1-1-1V3.8a1 1 0 0 1 1-1z" />
      <line x1="7.3" y1="10" x2="7.3" y2="13.6" />
      <line x1="10" y1="8.2" x2="10" y2="13.6" />
      <line x1="12.7" y1="11.4" x2="12.7" y2="13.6" />
    </>
  ),
  business: (
    <>
      <rect x="4" y="3" width="8.5" height="14" rx="0.8" />
      <path d="M12.5 8.5h3.5v8.5h-3.5" />
      <line x1="6.2" y1="6" x2="8.3" y2="6" />
      <line x1="6.2" y1="9" x2="8.3" y2="9" />
      <line x1="6.2" y1="12" x2="8.3" y2="12" />
    </>
  ),
  settings: (
    <>
      <circle cx="10" cy="10" r="2.6" />
      <path d="M10 3.3v2M10 14.7v2M3.3 10h2M14.7 10h2M5.4 5.4l1.4 1.4M13.2 13.2l1.4 1.4M14.6 5.4l-1.4 1.4M6.8 13.2l-1.4 1.4" />
    </>
  ),
  chevron: <path d="M6 8l4 4 4-4" />,
  account: (
    <>
      <circle cx="10" cy="7.2" r="3" />
      <path d="M4 16.8c0-3 2.7-4.9 6-4.9s6 1.9 6 4.9" />
    </>
  ),
};

export function NavIcon({ name, ...rest }: { name: NavIconName } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 20 20"
      width="17"
      height="17"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {PATHS[name]}
    </svg>
  );
}

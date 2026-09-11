/**
 * Response/request shapes mirrored by hand from the real backend source
 * (not generated) — src/modules/*​/*.service.ts and *.controller.ts in the
 * main repo. Kept intentionally narrow to what this SPA actually renders;
 * every field below has a matching field in the real backend interface it
 * names, so a backend shape change that isn't reflected here will show up
 * as a real TypeScript error the next time this file is touched, not a
 * silent runtime mismatch.
 */

export type Role = "owner" | "staff" | "read_only";

export interface VerifiedAccessToken {
  userId: string;
  tenantId: string;
  role: Role;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

export interface MfaEnrollmentRequired {
  mfaEnrollmentRequired: true;
  enrollmentToken: string;
}

export interface MfaEnrollStartResult {
  secret: string;
  otpauthUrl: string;
}

export interface StaffProfile {
  id: string;
  tenantId: string;
  email: string;
  role: Role;
  mfaEnabled: boolean;
  isActive: boolean;
  createdAt: string;
}

export type ItemType = "product" | "service";

export interface CatalogItem {
  id: string;
  tenantId: string;
  name: string;
  itemType: ItemType;
  sku?: string;
  unitPrice: number;
  durationMinutes?: number;
  isActive: boolean;
  createdAt: string;
}

export interface Customer {
  id: string;
  tenantId: string;
  displayName?: string;
  phone?: string;
  email?: string;
  createdAt: string;
}

export type SaleSource = "manual" | "imported";

export interface SaleLineItem {
  catalogItemId: string;
  quantity: number;
  unitPrice: number;
  discountAmount?: number;
}

export interface SaleTransaction {
  id: string;
  tenantId: string;
  customerId?: string;
  recordedByUserId?: string;
  source: SaleSource;
  occurredAt: string;
  subtotalAmount: number;
  discountAmount: number;
  totalAmount: number;
  dealId?: string;
  lineItems: SaleLineItem[];
  createdAt: string;
}

export interface Page<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

export type BookingStatus = "requested" | "confirmed" | "completed" | "cancelled" | "no_show";

export interface Booking {
  id: string;
  tenantId: string;
  customerId: string;
  catalogItemId: string;
  scheduledAt: string;
  durationMinutes: number;
  status: BookingStatus;
  notes?: string;
  createdAt: string;
}

export type SupportTicketSeverity = "low" | "normal" | "high" | "critical";
export type SupportTicketStatus = "open" | "in_progress" | "resolved";

export interface SupportTicket {
  id: string;
  tenantId: string;
  createdByUserId: string;
  subject: string;
  description: string;
  severity: SupportTicketSeverity;
  status: SupportTicketStatus;
  resolutionNotes?: string;
  createdAt: string;
  updatedAt: string;
}

interface Delta {
  current: number;
  previous: number;
  changePct: number | null;
}

interface Period {
  start: string;
  end: string;
}

export interface SnapshotFinding {
  headline: string;
  detail: string;
  severity: "positive" | "neutral" | "attention";
}

export interface SnapshotActionItem {
  title: string;
  rationale: string;
}

export interface OnboardingStep {
  key: string;
  label: string;
  completed: boolean;
}

export interface OnboardingStatus {
  steps: OnboardingStep[];
  completedCount: number;
  totalCount: number;
  percentComplete: number;
}

export interface BusinessSnapshot {
  period: Period;
  previousPeriod: Period;
  executiveSummary: string[];
  performance: {
    salesAmount: Delta;
    transactionalVolume: Delta;
    averageTransactionValue: Delta;
    totalUnits: Delta;
    conversionRate: { current: number | null; previous: number | null };
    churnRate: { current: number | null; previous: number | null };
    repeatRate: { current: number | null; previous: number | null };
  };
  experienceMetrics: {
    nps: { current: number | null; previous: number | null; currentCount: number };
    rating: { current: number | null; previous: number | null; currentCount: number };
  };
  growthAudit: {
    latestScore: number | null;
    latestBand: string | null;
    previousScore: number | null;
  };
  findings: SnapshotFinding[];
  actionPlan: SnapshotActionItem[];
  socialMetrics: { connected: boolean } & Record<string, unknown>;
  methodology: string[];
  generatedAt: string;
}

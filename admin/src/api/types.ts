/** Mirrors AdminAuthService's real response shapes (admin-auth/admin-auth.service.ts). */

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

export interface AdminMfaEnrollStartResult {
  secret: string;
  otpauthUrl: string;
}

/** Mirrors PublicAdminUserRecord. */
export interface AdminProfile {
  id: string;
  email: string;
  mfaEnabled: boolean;
  isActive: boolean;
  createdAt: string;
}

/** Mirrors TenantStatus/SubscriptionTier/SubscriptionStatus
 * (auth/tenant.service.ts). */
export type TenantStatus = "pilot" | "active" | "suspended";
export type SubscriptionTier = "free" | "pro_plus" | "growth_plan" | "growth_partner";
export type SubscriptionStatus = "active" | "pending_payment" | "past_due";

/** Mirrors AdminTenantSummary (admin/admin-tenant.service.ts). */
export interface AdminTenantSummary {
  tenantId: string;
  tenantName: string;
  status: TenantStatus;
  subscriptionTier: SubscriptionTier;
  subscriptionStatus: SubscriptionStatus;
  nextBillingDate: string | null;
  staffCount: number;
  openSupportTicketCount: number;
  growthAuditCount: number;
  latestGrowthAuditScore: number | null;
  latestGrowthAuditBand: string | null;
  npsScore: number | null;
  npsResponseCount: number;
  onboardingPercentComplete: number;
}

/** Mirrors PublicAuthUserRecord — the tenant staff shape, as seen
 * cross-tenant by an operator (frontend/'s own StaffProfile is the
 * tenant-scoped equivalent). */
export interface AdminTenantStaffMember {
  id: string;
  tenantId: string;
  staffIdNumber: string;
  email: string;
  firstName?: string;
  lastName?: string;
  role: string;
  mfaEnabled: boolean;
  isActive: boolean;
  createdAt: string;
}

/** Mirrors SubscriptionPayment (billing/subscription.service.ts). */
export interface AdminTenantSubscriptionPayment {
  id: string;
  tenantId: string;
  tier: Exclude<SubscriptionTier, "free">;
  amountZar: number;
  mopaySessionId: string;
  mopayReference: string;
  status: "pending" | "paid" | "failed";
  createdAt: string;
  paidAt?: string;
}

/** Mirrors AdminTenantDetail (admin/admin-tenant.service.ts). */
export interface AdminTenantDetail extends AdminTenantSummary {
  staff: AdminTenantStaffMember[];
  subscriptionPayments: AdminTenantSubscriptionPayment[];
}

/** Mirrors PlatformHealth and its nested shapes (admin/platform-health.service.ts). */
export interface QueueHealth {
  name: string;
  configured: boolean;
  waiting?: number;
  active?: number;
  completed?: number;
  failed?: number;
  delayed?: number;
}

export interface DatabaseHealth {
  configured: boolean;
  totalCount?: number;
  idleCount?: number;
  waitingCount?: number;
}

export interface BusinessMetrics {
  tenantCount: number;
  tenantsByTier: Record<string, number>;
  mrrZar: number;
  pastDueTenantCount: number;
  signupsByDay: { date: string; count: number }[];
}

export interface SupportTicketMetrics {
  openCount: number;
  inProgressCount: number;
  resolvedCount: number;
  averageResolutionHours: number | null;
}

export interface PlatformHealth {
  generatedAt: string;
  queues: QueueHealth[];
  database: DatabaseHealth;
  business: BusinessMetrics;
  supportTickets: SupportTicketMetrics;
}

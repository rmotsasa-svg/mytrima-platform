import { Injectable } from "@nestjs/common";
import { TenantService } from "../auth/tenant.service";
import { GrowthAuditService } from "../growth-audit/growth-audit.service";
import { SocialConnectionService } from "../social-publishing/social-connection.service";
import { CustomerService } from "../customers/customer.service";

/**
 * Real gap found by deep review: a brand-new tenant lands after
 * register -> MFA enroll -> login with nothing guiding them on what to do
 * next — no prompt to run their first Growth Audit, connect WhatsApp/social,
 * or add a first customer. For a 5-10 tenant pilot where every activation
 * matters, this is real, avoidable churn risk. This is deliberately a
 * computed status endpoint, not a stored "onboarding_state" row — every
 * signal below is already real data this platform tracks elsewhere; storing
 * a separate flag would just be a second, driftable source of truth for
 * something derivable on read.
 */
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

/** Pure function — given the real signals already gathered, decide which
 * steps are complete. Kept separate from OnboardingService.getStatus() so
 * the actual completeness logic is unit-testable without constructing any
 * of the four real services it would otherwise need, same pattern as
 * scoreAudit() being tested independently of GrowthAuditService. */
export function computeOnboardingStatus(signals: {
  hasGrowthAudit: boolean;
  hasNotificationPhone: boolean;
  hasSocialConnection: boolean;
  hasPayfastMerchantId: boolean;
  hasFirstCustomer: boolean;
}): OnboardingStatus {
  const steps: OnboardingStep[] = [
    { key: "growth_audit", label: "Complete your first Growth Audit", completed: signals.hasGrowthAudit },
    { key: "notification_phone", label: "Set a WhatsApp notification phone number", completed: signals.hasNotificationPhone },
    { key: "social_connected", label: "Connect a Facebook Page", completed: signals.hasSocialConnection },
    { key: "payfast_merchant_id", label: "Add your PayFast merchant id to accept payments", completed: signals.hasPayfastMerchantId },
    { key: "first_customer", label: "Add your first customer", completed: signals.hasFirstCustomer },
  ];
  const completedCount = steps.filter((s) => s.completed).length;
  return {
    steps,
    completedCount,
    totalCount: steps.length,
    percentComplete: Math.round((completedCount / steps.length) * 100),
  };
}

@Injectable()
export class OnboardingService {
  constructor(
    private readonly tenantService: TenantService,
    private readonly growthAuditService: GrowthAuditService,
    private readonly socialConnectionService: SocialConnectionService,
    private readonly customerService: CustomerService
  ) {}

  async getStatus(tenantId: string): Promise<OnboardingStatus> {
    const [tenant, auditResponses, socialConnection, customers] = await Promise.all([
      this.tenantService.getById(tenantId),
      this.growthAuditService.listForTenant(tenantId),
      this.socialConnectionService.getForTenant(tenantId),
      this.customerService.listForTenant(tenantId),
    ]);

    return computeOnboardingStatus({
      hasGrowthAudit: auditResponses.length > 0,
      hasNotificationPhone: !!tenant?.notificationPhoneE164,
      hasSocialConnection: socialConnection !== null,
      hasPayfastMerchantId: !!tenant?.payfastMerchantId,
      hasFirstCustomer: customers.length > 0,
    });
  }
}

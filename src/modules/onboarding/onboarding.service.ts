import { Injectable } from "@nestjs/common";
import { TenantService } from "../auth/tenant.service";
import { GrowthAuditService } from "../growth-audit/growth-audit.service";
import { SocialConnectionService } from "../social-publishing/social-connection.service";
import { CustomerService } from "../customers/customer.service";
import { GoalService } from "../goals/goal.service";

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

/** The six-step checklist's own shape — computeOnboardingStatus() below
 * returns exactly this, nothing more. OnboardingStatus (the real API
 * response shape) extends it with isFirstRun, assembled in
 * OnboardingService.getStatus() from a genuinely separate computation —
 * see OnboardingStatus.isFirstRun's own comment for why the two concepts
 * are kept apart even though they're returned together. */
export interface OnboardingChecklist {
  steps: OnboardingStep[];
  completedCount: number;
  totalCount: number;
  percentComplete: number;
}

export interface OnboardingStatus extends OnboardingChecklist {
  /** Phase 8 of the GrowthOS-aligned restructuring plan
   * (C:\Users\USER\.claude\plans\twinkly-sprouting-orbit.md). A separate
   * concept from the six-step checklist above (deliberately, not folded
   * into `steps`) — this is specifically the frontend's own gate for
   * whether to show the first-run wizard instead of the normal dashboard,
   * computed from just two real signals (a Goal and a submitted Growth
   * Audit), not all six checklist steps. A tenant can finish the wizard
   * (isFirstRun false) while still having unchecked boxes on this list —
   * connecting WhatsApp/PayFast/a Facebook Page stays real, optional,
   * ongoing setup, not a gate on ever reaching the dashboard at all. */
  isFirstRun: boolean;
}

/** Pure — see OnboardingStatus.isFirstRun's own comment for why this is
 * deliberately narrower than computeOnboardingStatus() above. Exported
 * standalone for the same "testable without constructing real services"
 * reason as computeOnboardingStatus() itself. */
export function computeIsFirstRun(hasGoal: boolean, hasGrowthAudit: boolean): boolean {
  return !(hasGoal && hasGrowthAudit);
}

/** Pure function — given the real signals already gathered, decide which
 * steps are complete. Kept separate from OnboardingService.getStatus() so
 * the actual completeness logic is unit-testable without constructing any
 * of the four real services it would otherwise need, same pattern as
 * scoreAudit() being tested independently of GrowthAuditService. */
export function computeOnboardingStatus(signals: {
  hasBusinessProfile: boolean;
  hasGrowthAudit: boolean;
  hasNotificationPhone: boolean;
  hasSocialConnection: boolean;
  hasPayfastMerchantId: boolean;
  hasFirstCustomer: boolean;
}): OnboardingChecklist {
  const steps: OnboardingStep[] = [
    // Added 2026-09-11, migration 0024 — the tenant asked directly where
    // the business-setup page was; this is the one step that's really the
    // starting point of every other one (a Growth Audit, a customer, even
    // the tenant's own name make more sense once someone can say what the
    // business actually is), so it leads the list. `description` is the
    // single clearest "have you told us anything about this business at
    // all" signal among the six new fields — same one-clean-boolean-per-
    // step discipline every step below already has.
    { key: "business_profile", label: "Tell us about your business", completed: signals.hasBusinessProfile },
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
    private readonly customerService: CustomerService,
    private readonly goalService: GoalService
  ) {}

  async getStatus(tenantId: string): Promise<OnboardingStatus> {
    const [tenant, auditResponses, socialConnection, customers, goals] = await Promise.all([
      this.tenantService.getById(tenantId),
      this.growthAuditService.listForTenant(tenantId),
      this.socialConnectionService.getForTenant(tenantId),
      this.customerService.listForTenant(tenantId),
      this.goalService.listForTenant(tenantId),
    ]);

    const checklist = computeOnboardingStatus({
      hasBusinessProfile: !!tenant?.description,
      hasGrowthAudit: auditResponses.length > 0,
      hasNotificationPhone: !!tenant?.notificationPhoneE164,
      hasSocialConnection: socialConnection !== null,
      hasPayfastMerchantId: !!tenant?.payfastMerchantId,
      hasFirstCustomer: customers.length > 0,
    });

    return { ...checklist, isFirstRun: computeIsFirstRun(goals.length > 0, auditResponses.length > 0) };
  }
}

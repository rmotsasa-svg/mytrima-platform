import { AuditResult } from "../growth-audit/growth-audit.service";
import { NpsResponse, categorize } from "../growth-audit/nps.service";

/**
 * Automation & Notification Engine (Master Plan Section 6): "workflow
 * triggers from audit findings and customer behaviour." This module decides
 * WHETHER something is worth a notification and WHAT it should say — pure,
 * in-house, fully testable logic with no vendor dependency.
 *
 * It deliberately does NOT deliver anything. Actual delivery depends on
 * WhatsApp (Master Plan Section 8 status: Assumed — see
 * src/modules/integrations/whatsapp/whatsapp.service.ts) or email, neither
 * of which is a resolved integration yet. It also does not schedule or queue
 * anything — Master Plan Section 4 names Redis/BullMQ for that, which this
 * scaffold has no runtime for. This service's job ends at producing a
 * NotificationEvent; wiring one to an actual send is separate, later work
 * that should call the relevant channel once it's unblocked.
 */

export type NotificationType =
  | "growth_audit_critical_band"
  | "growth_audit_weak_band"
  | "nps_detractor_followup"
  | "rating_hidden_after_moderation"
  | "kpi_benchmark_breach"
  | "new_booking_request";

export interface NotificationEvent {
  tenantId: string;
  type: NotificationType;
  /** Who this notification is ABOUT (e.g. the customer who left a detractor
   * score) — not who receives it. Every trigger here is "something tenant
   * staff need to act on," so the recipient is always the tenant, never the
   * customer directly; that routing decision belongs to whatever calls this
   * service, not to this module. */
  aboutCustomerId?: string;
  message: string;
  /** "urgent": a same-day action candidate once a real channel exists.
   * "normal": fine to appear in a digest. */
  priority: "urgent" | "normal";
}

/**
 * Master Plan Section 6/9: a Critical Growth Audit result is exactly the
 * case the grant proposal's dashboard concept is meant to surface urgently;
 * Weak deserves a normal-priority nudge. Stable/High-Growth results trigger
 * nothing — no action is being requested of anyone.
 */
export function notificationsForGrowthAudit(tenantId: string, result: AuditResult): NotificationEvent[] {
  if (result.band === "Critical") {
    return [
      {
        tenantId,
        type: "growth_audit_critical_band",
        message: `Growth Audit scored ${result.overallScore}/100 (Critical) — several core business fundamentals need attention. Review the section breakdown.`,
        priority: "urgent",
      },
    ];
  }
  if (result.band === "Weak") {
    return [
      {
        tenantId,
        type: "growth_audit_weak_band",
        message: `Growth Audit scored ${result.overallScore}/100 (Weak) — worth a closer look at the lowest-scoring sections.`,
        priority: "normal",
      },
    ];
  }
  return [];
}

/**
 * A detractor (NPS 0–6) is exactly the case Master Plan Section 9/10 flags
 * as needing "a fast, tracked follow-up path, not just a stored score" —
 * this is that trigger, reusing nps.service.ts's own categorize() rather
 * than re-deriving the 0–6/7–8/9–10 boundaries here.
 */
export function notificationsForNpsResponse(tenantId: string, response: NpsResponse): NotificationEvent[] {
  if (categorize(response.score) !== "detractor") return [];
  const commentSuffix = response.comment ? `: "${response.comment}"` : "";
  return [
    {
      tenantId,
      type: "nps_detractor_followup",
      aboutCustomerId: response.customerId,
      message: `Customer ${response.customerId} left a detractor score (${response.score}/10)${commentSuffix} — follow up promptly.`,
      priority: "urgent",
    },
  ];
}

/**
 * A rating moderated to 'hidden' is worth surfacing to the tenant even
 * though the public won't see it: it means a customer left feedback judged
 * unsuitable for publication, which is itself information the business
 * should act on. A rating moderated to 'public' triggers nothing — that's
 * the unremarkable, expected outcome.
 */
export function notificationsForModeratedRating(
  tenantId: string,
  customerId: string,
  stars: number,
  status: "public" | "hidden"
): NotificationEvent[] {
  if (status !== "hidden") return [];
  return [
    {
      tenantId,
      type: "rating_hidden_after_moderation",
      aboutCustomerId: customerId,
      message: `A ${stars}-star rating from customer ${customerId} was hidden after moderation — review it directly with the customer if appropriate.`,
      priority: "normal",
    },
  ];
}

/**
 * Master Plan Addendum v1.3, Section E ("KPI benchmarks & automated
 * alerts"): the fourth trigger, and the first one that isn't synchronous —
 * see KpiBenchmarkCheckService for the scheduled job that calls this once a
 * day per tenant, comparing real computed KPIs against any active
 * kpi_benchmark rows.
 */
export function notificationsForKpiBenchmarkBreach(tenantId: string, kpi: string, actualValue: number, thresholdValue: number, comparison: "above" | "below"): NotificationEvent[] {
  const direction = comparison === "above" ? "risen above" : "fallen below";
  return [
    {
      tenantId,
      type: "kpi_benchmark_breach",
      message: `${kpi} has ${direction} your set threshold of ${thresholdValue} (currently ${actualValue}).`,
      priority: "normal",
    },
  ];
}

/**
 * Booking module, added 2026-09-10: a new booking always starts in
 * "requested" status (booking.service.ts), so this is unconditional, unlike
 * every trigger above — the tenant needs to know about every single one,
 * not just a subset crossing some threshold, since each one needs a real
 * human decision (confirm or decline) before the requested time arrives.
 * "urgent": same-day-actionable, matching the growth-audit critical-band
 * priority — a booking has a real clock ticking against it that those
 * other triggers don't.
 */
export function notificationsForNewBookingRequest(tenantId: string, customerId: string, scheduledAt: Date): NotificationEvent[] {
  return [
    {
      tenantId,
      type: "new_booking_request",
      aboutCustomerId: customerId,
      message: `New booking request from customer ${customerId} for ${scheduledAt.toISOString()} — confirm or decline it.`,
      priority: "urgent",
    },
  ];
}

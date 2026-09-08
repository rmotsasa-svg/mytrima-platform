import { Inject, Injectable } from "@nestjs/common";
import { NPS_RESPONSE_STORE } from "./nps.tokens";

/**
 * Master Plan Section 8 status: Verified (build decision) — no vendor
 * integration needed. Methodology: a single 0–10 recommend-likelihood
 * question plus an open-text follow-up (Reichheld, "The One Number You Need
 * to Grow," Harvard Business Review, December 2003), reusing the same
 * response/scoring data model as the Growth Audit engine rather than
 * duplicating it via a third-party vendor (Delighted, discontinued by
 * Qualtrics mid-2026, is the cautionary example for why not to depend on one).
 */

export type NpsCategory = "detractor" | "passive" | "promoter";

export interface NpsResponse {
  customerId: string;
  score: number; // 0-10
  comment?: string;
  submittedAt: Date;
}

export class InvalidNpsScoreError extends Error {
  constructor(score: number) {
    super(`NPS score must be an integer 0–10, got ${score}`);
    this.name = "InvalidNpsScoreError";
  }
}

export function categorize(score: number): NpsCategory {
  if (!Number.isInteger(score) || score < 0 || score > 10) {
    throw new InvalidNpsScoreError(score);
  }
  if (score <= 6) return "detractor";
  if (score <= 8) return "passive";
  return "promoter";
}

/**
 * Standard NPS formula: % promoters − % detractors, expressed as a whole
 * number from −100 to +100 (passives count toward the denominator only).
 */
export function computeNps(responses: NpsResponse[]): number {
  if (responses.length === 0) return 0;
  let promoters = 0;
  let detractors = 0;
  for (const r of responses) {
    const category = categorize(r.score);
    if (category === "promoter") promoters++;
    if (category === "detractor") detractors++;
  }
  const pctPromoters = (promoters / responses.length) * 100;
  const pctDetractors = (detractors / responses.length) * 100;
  return Math.round(pctPromoters - pctDetractors);
}

/**
 * Master Plan Section 9/10 requirement: detractors need a fast, tracked
 * follow-up path, not just a stored score. This flags which responses need
 * action rather than deciding what that action is — the automation/
 * notification engine (Master Plan Section 6) owns the actual workflow.
 */
export function needsFollowUp(response: NpsResponse): boolean {
  return categorize(response.score) === "detractor";
}

/**
 * Closes the KNOWN GAP flagged on NpsController since this scaffold's NPS
 * logic was first written: categorize()/needsFollowUp() on a single
 * submitted score were always real and correct, but nothing persisted a
 * response, so computeNps() (the tenant-wide aggregate) had nothing to
 * aggregate over via HTTP — `nps_response` (migration 0006) now backs it.
 * The pure functions above stay pure and unchanged — this wraps them with
 * the one thing they can't do themselves: remembering a response past the
 * single request that computed it, the exact same pattern
 * GrowthAuditService uses around scoreAudit().
 */
export interface StoredNpsResponse extends NpsResponse {
  id: string;
  tenantId: string;
}

export interface NpsResponseStore {
  save(response: StoredNpsResponse): Promise<void>;
  findAllForTenant(tenantId: string): Promise<StoredNpsResponse[]>;
}

@Injectable()
export class NpsService {
  constructor(@Inject(NPS_RESPONSE_STORE) private readonly store: NpsResponseStore) {}

  /**
   * categorize() throws InvalidNpsScoreError on a bad score before this ever
   * reaches the store — a rejected submission is never persisted, same
   * guarantee GrowthAuditService.submit() gives around scoreAudit().
   *
   * KNOWN GAP: `customerId` is trusted as given — this endpoint has no auth
   * guard, same limitation GrowthAuditController's persistence carries (see
   * that file's own comment); not attempted here to keep this change scoped
   * to persistence alone.
   */
  async submit(tenantId: string, customerId: string, score: number, id: string, comment?: string): Promise<StoredNpsResponse> {
    categorize(score); // validates; throws InvalidNpsScoreError on bad input
    const response: StoredNpsResponse = { id, tenantId, customerId, score, comment, submittedAt: new Date() };
    await this.store.save(response);
    return response;
  }

  /** The tenant-wide NPS number computeNps() always could compute, now with
   * something real behind it via HTTP. */
  async aggregateForTenant(tenantId: string): Promise<{ nps: number; count: number }> {
    const all = await this.store.findAllForTenant(tenantId);
    return { nps: computeNps(all), count: all.length };
  }
}

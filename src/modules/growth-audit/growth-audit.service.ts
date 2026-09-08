import { Inject, Injectable } from "@nestjs/common";
import { SECTIONS, ALL_QUESTION_IDS, SectionKey } from "./questions.data";
import { GROWTH_AUDIT_RESPONSE_STORE } from "./growth-audit.tokens";

export type Answers = Record<number, number>; // question id -> score 0..4

export interface SectionResult {
  key: SectionKey;
  name: string;
  rawScore: number;
  maxScore: number;
  sectionPct: number; // 0..100
  weightPct: number;
  weightedContribution: number; // sectionPct * weightPct / 100
}

export type PerformanceBand = "Critical" | "Weak" | "Stable" | "High-Growth";

export interface AuditResult {
  sections: SectionResult[];
  overallScore: number; // 0..100, sum of weightedContribution
  band: PerformanceBand;
}

export class InvalidAuditAnswersError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidAuditAnswersError";
  }
}

/**
 * Validates a full answer set against the 40-question instrument.
 * Every question must be present, and every score must be an integer 0–4 —
 * matching the questionnaire's scoring scale exactly (Section 3 of the docx).
 * Throws rather than silently defaulting a missing answer to 0: a missing
 * answer is a data-entry problem, not a legitimate "Absent" score, and
 * conflating the two would corrupt the baseline without anyone noticing.
 */
export function validateAnswers(answers: Answers): void {
  const missing = ALL_QUESTION_IDS.filter((id) => !(id in answers));
  if (missing.length > 0) {
    throw new InvalidAuditAnswersError(`Missing answers for question id(s): ${missing.join(", ")}`);
  }
  for (const id of ALL_QUESTION_IDS) {
    const v = answers[id];
    if (!Number.isInteger(v) || v < 0 || v > 4) {
      throw new InvalidAuditAnswersError(`Question ${id} has invalid score ${v}; must be an integer 0–4`);
    }
  }
  const extra = Object.keys(answers)
    .map(Number)
    .filter((id) => !ALL_QUESTION_IDS.includes(id));
  if (extra.length > 0) {
    throw new InvalidAuditAnswersError(`Unknown question id(s) in answers: ${extra.join(", ")}`);
  }
}

/**
 * Computes the baseline Growth Audit score, following the exact formula in
 * the questionnaire's "Scoring Worksheet" (Section 11 of the docx):
 *   section % = raw ÷ (questions × 4) × 100
 *   weighted contribution = section % × section weight
 *   overall = sum of weighted contributions (0–100)
 * and maps it to the same Performance Scale Index bands already defined in
 * the grant proposal, so a score computed here means the same thing as a
 * score written on the printed instrument by hand.
 */
export function scoreAudit(answers: Answers): AuditResult {
  validateAnswers(answers);

  const sections: SectionResult[] = SECTIONS.map((section) => {
    const rawScore = section.questionIds.reduce((sum, id) => sum + answers[id], 0);
    const maxScore = section.questionIds.length * 4;
    const sectionPct = (rawScore / maxScore) * 100;
    const weightedContribution = (sectionPct * section.weightPct) / 100;
    return {
      key: section.key,
      name: section.name,
      rawScore,
      maxScore,
      sectionPct,
      weightPct: section.weightPct,
      weightedContribution,
    };
  });

  const overallScore = round2(sections.reduce((sum, s) => sum + s.weightedContribution, 0));

  return { sections, overallScore, band: bandFor(overallScore) };
}

export function bandFor(score: number): PerformanceBand {
  if (score < 0 || score > 100) {
    throw new InvalidAuditAnswersError(`Score out of range: ${score}`);
  }
  if (score <= 40) return "Critical";
  if (score <= 60) return "Weak";
  if (score <= 75) return "Stable";
  return "High-Growth";
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Closes the KNOWN GAP flagged on GrowthAuditController since this scaffold's
 * first migration: `growth_audit_response` has existed, with RLS, since
 * 0001_tenant_and_rls.sql — nothing ever read or wrote it. scoreAudit()
 * above stays a pure function (still directly unit-tested with no store at
 * all); this wraps it with the one thing it can't do itself: remembering the
 * result past the single request that computed it.
 */
export interface GrowthAuditResponse {
  id: string;
  tenantId: string;
  answers: Answers;
  result: AuditResult;
  submittedAt: Date;
}

export interface GrowthAuditResponseStore {
  save(response: GrowthAuditResponse): Promise<void>;
  findAllForTenant(tenantId: string): Promise<GrowthAuditResponse[]>;
}

@Injectable()
export class GrowthAuditService {
  constructor(@Inject(GROWTH_AUDIT_RESPONSE_STORE) private readonly store: GrowthAuditResponseStore) {}

  /**
   * scoreAudit() still does all the actual validation/scoring and still
   * throws InvalidAuditAnswersError exactly as before on bad input — this
   * method adds only persistence around it, so a rejected submission is
   * never written to the store.
   *
   * KNOWN GAP: `administered_by` (nullable in the schema) is never set —
   * GrowthAuditController has no auth guard yet, so there is no verified
   * caller identity to attribute a submission to. Threading that through
   * would mean putting this endpoint behind AccessTokenGuard first (see
   * access-token.guard.ts), not attempted here to keep this change scoped
   * to persistence alone.
   */
  async submit(tenantId: string, answers: Answers, id: string): Promise<GrowthAuditResponse> {
    const result = scoreAudit(answers);
    const response: GrowthAuditResponse = { id, tenantId, answers, result, submittedAt: new Date() };
    await this.store.save(response);
    return response;
  }

  async listForTenant(tenantId: string): Promise<GrowthAuditResponse[]> {
    return this.store.findAllForTenant(tenantId);
  }
}

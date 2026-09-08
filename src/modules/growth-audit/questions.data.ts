// Mirrors Mytrima_Growth_Audit_Questionnaire.docx exactly. Question ids 1–40,
// section boundaries, and weights must stay in sync with that document — if the
// questionnaire changes, this file (and the scoring worksheet in the docx) both
// need updating together, or the platform's baseline score will silently diverge
// from the printed instrument consultants administer.

export type SectionKey = "A" | "B" | "C" | "D" | "E" | "F" | "G";

export interface Section {
  key: SectionKey;
  name: string;
  weightPct: number; // must sum to 100 across all sections
  questionIds: number[]; // 1-indexed, matching the questionnaire
}

export const SECTIONS: Section[] = [
  { key: "A", name: "Sales & Conversion", weightPct: 20, questionIds: range(1, 8) },
  { key: "B", name: "Customer Experience", weightPct: 20, questionIds: range(9, 16) },
  { key: "C", name: "Business Strategy", weightPct: 15, questionIds: range(17, 22) },
  { key: "D", name: "Customer Retention", weightPct: 15, questionIds: range(23, 28) },
  { key: "E", name: "Brand & Positioning", weightPct: 10, questionIds: range(29, 32) },
  { key: "F", name: "Marketing & Engagement", weightPct: 10, questionIds: range(33, 36) },
  { key: "G", name: "Data & Performance Management", weightPct: 10, questionIds: range(37, 40) },
];

function range(start: number, end: number): number[] {
  const out: number[] = [];
  for (let i = start; i <= end; i++) out.push(i);
  return out;
}

export const QUESTION_TEXT: Record<number, string> = {
  1: "How quickly does your business make first contact with a new inbound enquiry (call, WhatsApp, form, walk-in)?",
  2: "Do you have a documented, repeatable follow-up sequence for leads who don't convert on first contact?",
  3: "Can you state your lead-to-sale conversion rate for the last quarter, and is it tracked routinely rather than estimated?",
  4: "Do you use a structured sales script or objection-handling guide for common pushback?",
  5: "Is there a defined sales pipeline with named stages that every lead is tracked through?",
  6: "Do you track win rate (deals won ÷ qualified opportunities) and know your current number?",
  7: "Is responsibility for each stage of the sales process clearly assigned to a specific person or role?",
  8: "Do you review lost or declined sales to identify recurring reasons customers don't buy?",
  9: "Do you measure customer satisfaction or loyalty in a structured way after a purchase or service interaction?",
  10: "Have you mapped the full customer journey from first contact to post-purchase?",
  11: "Is there a documented, consistent service standard for how staff greet, serve, and follow up with customers?",
  12: "Do you have a defined process for handling complaints — owner, response-time target, resolution steps?",
  13: "When something goes wrong for a customer, do you have a standard \"make-it-right\" response?",
  14: "Do you track how long it takes to resolve a customer complaint or support ticket, start to finish?",
  15: "Do you collect and review customer feedback on a regular schedule?",
  16: "Have staff been trained specifically on customer-experience standards in the last 12 months?",
  17: "Can you state, in one sentence, what makes your business different from your closest competitors?",
  18: "Do you know your approximate cost to acquire a new customer?",
  19: "Do you know your approximate customer lifetime value?",
  20: "Do you have a written business plan or strategy document reviewed at least annually?",
  21: "Have you formally assessed strengths, weaknesses, opportunities, and threats in the last 12 months?",
  22: "Could the business continue operating for an extended period without the owner's day-to-day involvement?",
  23: "Do you know your current customer churn / attrition rate over a defined period?",
  24: "Can you identify which customers haven't purchased in the last 3–12 months?",
  25: "Do you have a defined process for re-engaging dormant or lapsed customers?",
  26: "Do you track repeat purchase rate?",
  27: "Is there a structured loyalty, referral, or renewal program in place?",
  28: "Do you segment customers by value and treat them differently?",
  29: "Is your brand consistent across website, social media, signage, and printed materials?",
  30: "Do you have a clear, written value proposition or tagline?",
  31: "Do you actively monitor what customers and the public say about your brand online?",
  32: "Have you benchmarked your pricing and positioning against your top 2–3 competitors in the last 12 months?",
  33: "Do you track which marketing channels actually produce paying customers, not just enquiries?",
  34: "Do you follow a content or posting schedule for your social/digital presence?",
  35: "Can you calculate the return on investment of your last marketing campaign or spend?",
  36: "Do you use WhatsApp, SMS, or email in a structured way to re-engage past enquiries and customers?",
  37: "Do you review a defined set of key business numbers on a regular schedule?",
  38: "Are your core business numbers recorded in a system rather than kept only in memory or on paper?",
  39: "Do you set numeric targets for key metrics and track performance against them?",
  40: "If you had to hand this business to someone else tomorrow, could they find the numbers to run it?",
};

export const ALL_QUESTION_IDS: number[] = SECTIONS.flatMap((s) => s.questionIds);

// Sanity checks that run at module load time — if the questionnaire and this
// file ever drift out of sync, importing this module fails loudly instead of
// silently producing a wrong baseline score.
(function assertIntegrity() {
  const totalWeight = SECTIONS.reduce((sum, s) => sum + s.weightPct, 0);
  if (totalWeight !== 100) {
    throw new Error(`Section weights must sum to 100, got ${totalWeight}`);
  }
  if (ALL_QUESTION_IDS.length !== 40) {
    throw new Error(`Expected 40 questions, got ${ALL_QUESTION_IDS.length}`);
  }
  const sorted = [...ALL_QUESTION_IDS].sort((a, b) => a - b);
  for (let i = 0; i < 40; i++) {
    if (sorted[i] !== i + 1) {
      throw new Error(`Question ids must be exactly 1–40 with no gaps/duplicates; found ${sorted[i]} at position ${i}`);
    }
  }
  for (const id of ALL_QUESTION_IDS) {
    if (!QUESTION_TEXT[id]) {
      throw new Error(`Missing question text for id ${id}`);
    }
  }
})();

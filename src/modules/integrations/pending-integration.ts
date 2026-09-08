/**
 * Every integration gated by the Technical Master Plan's Section 8/16
 * verification checklist throws this instead of a silent no-op or a mocked
 * success response. A stub that quietly "succeeds" is worse than one that
 * fails loudly — it lets a developer build and demo against fake data without
 * noticing the vendor relationship was never actually confirmed.
 */
export class PendingVerificationError extends Error {
  constructor(
    public readonly integrationName: string,
    public readonly masterPlanStatus: "Assumed" | "Needs verification",
    public readonly whatsBlocking: string
  ) {
    super(
      `${integrationName} is not implemented: Master Plan status is "${masterPlanStatus}". ` +
        `Blocked on: ${whatsBlocking}. See Technical Master Plan, Section 8 and Section 16.`
    );
    this.name = "PendingVerificationError";
  }
}

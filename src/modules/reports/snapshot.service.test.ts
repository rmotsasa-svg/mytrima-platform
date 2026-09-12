import { buildFindingsAndMethodology, computeDailyBudget } from "./snapshot.service";
import { SalesKpis, RepeatRateResult } from "../sales/sale.service";
import { SalesTarget } from "../sales/sales-target.service";

function makeKpis(overrides: Partial<SalesKpis> = {}): SalesKpis {
  return {
    periodStart: new Date("2026-02-01"),
    periodEnd: new Date("2026-02-28"),
    transactionalVolume: 10,
    salesAmount: 1000,
    averageTransactionValue: 100,
    totalUnits: 15,
    unitsPerTransaction: 1.5,
    addonRate: 20,
    conversionRate: 30,
    churnRate: 10,
    ...overrides,
  };
}

function makeRepeatRate(overrides: Partial<RepeatRateResult> = {}): RepeatRateResult {
  return {
    periodStart: new Date("2026-02-01"),
    periodEnd: new Date("2026-02-28"),
    newCustomerCount: 20,
    repeatCustomerCount: 10,
    repeatRate: 50,
    ...overrides,
  };
}

describe("buildFindingsAndMethodology", () => {
  test("no findings when nothing changed meaningfully", () => {
    const { findings } = buildFindingsAndMethodology({
      salesKpis: makeKpis(),
      previousSalesKpis: makeKpis(),
      repeatRate: makeRepeatRate(),
      previousRepeatRate: makeRepeatRate(),
      nps: { current: 20, previous: 20 },
      rating: { current: 4, previous: 4 },
      hasLocationBreakdown: false,
    });
    expect(findings).toHaveLength(0);
  });

  test("surfaces a churn-rate-up finding when the change is meaningful", () => {
    const { findings } = buildFindingsAndMethodology({
      salesKpis: makeKpis({ churnRate: 30 }),
      previousSalesKpis: makeKpis({ churnRate: 10 }),
      repeatRate: makeRepeatRate(),
      previousRepeatRate: makeRepeatRate(),
      nps: { current: null, previous: null },
      rating: { current: null, previous: null },
      hasLocationBreakdown: false,
    });
    expect(findings.some((f) => f.title === "Churn rate is up")).toBe(true);
  });

  test("surfaces a repeat-rate-dropped finding with a real, derivable dollar estimate", () => {
    const { findings } = buildFindingsAndMethodology({
      salesKpis: makeKpis({ averageTransactionValue: 50 }),
      previousSalesKpis: makeKpis({ averageTransactionValue: 50 }),
      repeatRate: makeRepeatRate({ newCustomerCount: 20, repeatRate: 30 }),
      previousRepeatRate: makeRepeatRate({ repeatRate: 60 }),
      nps: { current: null, previous: null },
      rating: { current: null, previous: null },
      hasLocationBreakdown: false,
    });
    const finding = findings.find((f) => f.title === "New-customer repeat rate dropped");
    expect(finding).toBeDefined();
    // 30-point drop x 20 new customers x $50 avg order value / 100 = $300 estimated impact.
    expect(finding?.body).toContain("300");
  });

  test("ignores a change below the meaningful-change threshold", () => {
    const { findings } = buildFindingsAndMethodology({
      salesKpis: makeKpis({ churnRate: 12 }),
      previousSalesKpis: makeKpis({ churnRate: 10 }),
      repeatRate: makeRepeatRate(),
      previousRepeatRate: makeRepeatRate(),
      nps: { current: null, previous: null },
      rating: { current: null, previous: null },
      hasLocationBreakdown: false,
    });
    expect(findings).toHaveLength(0);
  });

  test("does not surface a finding when there's no previous-period value to compare against", () => {
    const { findings } = buildFindingsAndMethodology({
      salesKpis: makeKpis({ churnRate: 50 }),
      previousSalesKpis: makeKpis({ churnRate: null }),
      repeatRate: makeRepeatRate(),
      previousRepeatRate: null,
      nps: { current: 50, previous: null },
      rating: { current: null, previous: null },
      hasLocationBreakdown: false,
    });
    expect(findings).toHaveLength(0);
  });

  test("methodology always discloses no per-location breakdown and self-referential comparison", () => {
    const { methodology } = buildFindingsAndMethodology({
      salesKpis: makeKpis(),
      previousSalesKpis: makeKpis(),
      repeatRate: makeRepeatRate(),
      previousRepeatRate: makeRepeatRate(),
      nps: { current: null, previous: null },
      rating: { current: null, previous: null },
      hasLocationBreakdown: false,
    });
    expect(methodology.some((m) => m.includes("per-location"))).toBe(true);
    expect(methodology.some((m) => m.includes("own immediately preceding period"))).toBe(true);
  });
});

function makeTarget(overrides: Partial<SalesTarget> = {}): SalesTarget {
  return {
    id: "target-1",
    tenantId: "t1",
    periodStart: new Date("2026-09-01T00:00:00Z"),
    periodEnd: new Date("2026-09-30T23:59:59.999Z"),
    targetAmount: 3000,
    createdAt: new Date("2026-08-25T00:00:00Z"),
    ...overrides,
  };
}

describe("computeDailyBudget", () => {
  const now = new Date("2026-09-15T12:00:00Z");

  test("prorates a real tenant-level target covering today across every real day in its period", () => {
    // September has 30 days -> 3000 / 30 = 100/day.
    const budget = computeDailyBudget([makeTarget()], now);
    expect(budget).toBe(100);
  });

  test("returns null — not a fabricated number — when no target covers today", () => {
    const target = makeTarget({ periodStart: new Date("2026-01-01T00:00:00Z"), periodEnd: new Date("2026-01-31T23:59:59.999Z") });
    expect(computeDailyBudget([target], now)).toBeNull();
  });

  test("ignores a per-staff target (userId set) — only tenant-level targets count", () => {
    const staffTarget = makeTarget({ userId: "user-1" });
    expect(computeDailyBudget([staffTarget], now)).toBeNull();
  });

  test("when two tenant-level targets both cover today, the most recently created one wins", () => {
    const older = makeTarget({ id: "old", targetAmount: 3000, createdAt: new Date("2026-08-01T00:00:00Z") });
    const newer = makeTarget({ id: "new", targetAmount: 6000, createdAt: new Date("2026-09-01T00:00:00Z") });
    // Newer target: 6000 / 30 days = 200/day.
    expect(computeDailyBudget([older, newer], now)).toBe(200);
  });

  test("a single-day target prorates to its own full amount", () => {
    const target = makeTarget({
      periodStart: new Date("2026-09-15T00:00:00Z"),
      periodEnd: new Date("2026-09-15T23:59:59.999Z"),
      targetAmount: 500,
    });
    expect(computeDailyBudget([target], now)).toBe(500);
  });
});

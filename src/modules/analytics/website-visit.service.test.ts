import {
  AnalyticsService,
  InvalidVisitError,
  WebsiteVisit,
  WebsiteVisitStore,
  classifyDeviceType,
  computeAnalyticsSummary,
} from "./website-visit.service";

describe("classifyDeviceType", () => {
  it("classifies real mobile user-agent strings", () => {
    expect(classifyDeviceType("Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/128 Mobile")).toBe("mobile");
    expect(classifyDeviceType("Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15")).toBe("mobile");
  });

  it("classifies real tablet user-agent strings", () => {
    expect(classifyDeviceType("Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15")).toBe("tablet");
  });

  it("classifies real desktop user-agent strings", () => {
    expect(classifyDeviceType("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128 Safari/537.36")).toBe("desktop");
  });

  it("falls back to other for missing or unrecognized user-agent", () => {
    expect(classifyDeviceType(undefined)).toBe("other");
    expect(classifyDeviceType("curl/8.4.0")).toBe("other");
  });
});

function visit(overrides: Partial<WebsiteVisit>): WebsiteVisit {
  return {
    id: "v1",
    tenantId: "t1",
    sessionId: "s1",
    path: "/",
    deviceType: "desktop",
    occurredAt: new Date("2026-09-10T12:00:00.000Z"),
    ...overrides,
  };
}

describe("computeAnalyticsSummary", () => {
  const period = { start: new Date("2026-09-01T00:00:00.000Z"), end: new Date("2026-09-30T23:59:59.999Z") };

  it("counts total visits and unique sessions separately", () => {
    const summary = computeAnalyticsSummary(
      [visit({ id: "1", sessionId: "s1" }), visit({ id: "2", sessionId: "s1" }), visit({ id: "3", sessionId: "s2" })],
      period
    );
    expect(summary.totalVisits).toBe(3);
    expect(summary.uniqueSessions).toBe(2);
  });

  it("ranks top paths and top referrers by frequency, labeling missing referrer as Direct", () => {
    const summary = computeAnalyticsSummary(
      [
        visit({ id: "1", path: "/pricing", referrer: "https://google.com" }),
        visit({ id: "2", path: "/pricing", referrer: "https://google.com" }),
        visit({ id: "3", path: "/about" }),
      ],
      period
    );
    expect(summary.topPaths[0]).toEqual({ path: "/pricing", count: 2 });
    expect(summary.topReferrers[0]).toEqual({ referrer: "https://google.com", count: 2 });
    expect(summary.topReferrers.find((r) => r.referrer === "Direct")).toEqual({ referrer: "Direct", count: 1 });
  });

  it("breaks visits down by device type", () => {
    const summary = computeAnalyticsSummary(
      [visit({ id: "1", deviceType: "mobile" }), visit({ id: "2", deviceType: "mobile" }), visit({ id: "3", deviceType: "desktop" })],
      period
    );
    expect(summary.deviceBreakdown).toEqual({ desktop: 1, mobile: 2, tablet: 0, other: 0 });
  });

  it("buckets visits by day using the UTC calendar date", () => {
    const summary = computeAnalyticsSummary(
      [
        visit({ id: "1", occurredAt: new Date("2026-09-10T08:00:00.000Z") }),
        visit({ id: "2", occurredAt: new Date("2026-09-10T20:00:00.000Z") }),
        visit({ id: "3", occurredAt: new Date("2026-09-11T01:00:00.000Z") }),
      ],
      period
    );
    expect(summary.visitsByDay).toEqual([
      { date: "2026-09-10", count: 2 },
      { date: "2026-09-11", count: 1 },
    ]);
  });

  it("returns a zeroed-out summary for an empty period with no fabricated data", () => {
    const summary = computeAnalyticsSummary([], period);
    expect(summary.totalVisits).toBe(0);
    expect(summary.uniqueSessions).toBe(0);
    expect(summary.topPaths).toEqual([]);
    expect(summary.visitsByDay).toEqual([]);
  });
});

class FakeWebsiteVisitStore implements WebsiteVisitStore {
  saved: WebsiteVisit[] = [];
  async save(visit: WebsiteVisit): Promise<void> {
    this.saved.push(visit);
  }
  async findAllForTenant(tenantId: string): Promise<WebsiteVisit[]> {
    return this.saved.filter((v) => v.tenantId === tenantId);
  }
}

describe("AnalyticsService", () => {
  it("rejects an empty path — never a real page — without touching the store", async () => {
    const store = new FakeWebsiteVisitStore();
    const service = new AnalyticsService(store);
    await expect(
      service.recordVisit({ id: "v1", tenantId: "t1", sessionId: "s1", path: "   " })
    ).rejects.toBeInstanceOf(InvalidVisitError);
    expect(store.saved).toHaveLength(0);
  });

  it("derives device_type server-side and never stores the raw user-agent anywhere on the record", async () => {
    const store = new FakeWebsiteVisitStore();
    const service = new AnalyticsService(store);
    await service.recordVisit({
      id: "v1",
      tenantId: "t1",
      sessionId: "s1",
      path: "/",
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15",
    });
    expect(store.saved[0].deviceType).toBe("mobile");
    expect(JSON.stringify(store.saved[0])).not.toContain("iPhone");
  });
});

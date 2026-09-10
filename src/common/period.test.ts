import { previousPeriod, computeDelta } from "./period";

describe("previousPeriod", () => {
  test("a 31-day period gives an immediately-preceding period of the same length, no gap, no overlap", () => {
    const period = { start: new Date("2026-07-01T00:00:00.000Z"), end: new Date("2026-07-31T23:59:59.999Z") };
    const prev = previousPeriod(period);
    // Same length.
    expect(prev.end.getTime() - prev.start.getTime()).toBe(period.end.getTime() - period.start.getTime());
    // No gap: prev.end is exactly 1ms before period.start.
    expect(prev.end.getTime()).toBe(period.start.getTime() - 1);
  });

  test("a single-day period's previous period is also a single day", () => {
    const period = { start: new Date("2026-07-15T00:00:00.000Z"), end: new Date("2026-07-15T00:00:00.000Z") };
    const prev = previousPeriod(period);
    expect(prev.start.getTime()).toBe(prev.end.getTime());
  });
});

describe("computeDelta", () => {
  test("computes a real absolute and percent change", () => {
    const delta = computeDelta(120, 100);
    expect(delta.absoluteChange).toBe(20);
    expect(delta.percentChange).toBe(20);
  });

  test("handles a decrease correctly", () => {
    const delta = computeDelta(80, 100);
    expect(delta.absoluteChange).toBe(-20);
    expect(delta.percentChange).toBe(-20);
  });

  test("returns null change fields when there's no previous value — not a fabricated 0", () => {
    const delta = computeDelta(50, null);
    expect(delta.absoluteChange).toBeNull();
    expect(delta.percentChange).toBeNull();
  });

  test("returns a null percentChange (not Infinity or 0) when previous is exactly zero", () => {
    const delta = computeDelta(50, 0);
    expect(delta.absoluteChange).toBe(50);
    expect(delta.percentChange).toBeNull();
  });
});

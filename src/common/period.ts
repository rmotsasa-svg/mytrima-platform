/**
 * Real gap found by deep review: every KPI report in this platform except
 * Growth Audit is a point-in-time snapshot — a tenant can't see "is my
 * churn getting better or worse" without saving old numbers themselves,
 * even though the underlying data (every sale, rating, NPS response) is
 * already timestamped. This is the shared building block for closing that
 * gap: given a period, compute the immediately-preceding period of the
 * SAME length, so any KPI can be compared against its own recent past —
 * self-referential, same "no fabricated benchmark" discipline as
 * everywhere else in this project.
 */
export interface Period {
  start: Date;
  end: Date;
}

/** The period immediately before `period`, the same length, with no gap
 * and no overlap — e.g. given [Jul 1, Jul 31], returns [Jun 1, Jun 30]. */
export function previousPeriod(period: Period): Period {
  const lengthMs = period.end.getTime() - period.start.getTime();
  return {
    start: new Date(period.start.getTime() - lengthMs - 1),
    end: new Date(period.start.getTime() - 1),
  };
}

export interface Delta {
  current: number;
  previous: number | null;
  /** current - previous. null when there's no previous value to compare
   * against — not the same claim as "no change". */
  absoluteChange: number | null;
  /** (current - previous) / previous x 100. null when previous is null OR
   * zero (a percentage change from zero is undefined, not infinite or 0 —
   * reported as null rather than a misleading number). */
  percentChange: number | null;
}

/** Real, honest delta computation — every null case here is a real "can't
 * be computed," not a guessed 0. */
export function computeDelta(current: number, previous: number | null): Delta {
  if (previous === null) {
    return { current, previous: null, absoluteChange: null, percentChange: null };
  }
  const absoluteChange = Math.round((current - previous) * 100) / 100;
  const percentChange = previous !== 0 ? Math.round(((current - previous) / previous) * 10000) / 100 : null;
  return { current, previous, absoluteChange, percentChange };
}

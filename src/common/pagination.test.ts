import { parsePagination } from "./pagination";

test("defaults to limit 50, offset 0 when nothing is given", () => {
  expect(parsePagination()).toEqual({ limit: 50, offset: 0 });
});

test("parses real, valid limit/offset query strings", () => {
  expect(parsePagination("10", "20")).toEqual({ limit: 10, offset: 20 });
});

test("clamps a limit above the real maximum instead of trusting it — the exact unbounded-query problem this exists to prevent", () => {
  expect(parsePagination("100000", "0")).toEqual({ limit: 200, offset: 0 });
});

test("falls back to the default limit for a non-numeric or non-positive value", () => {
  expect(parsePagination("not-a-number", undefined).limit).toBe(50);
  expect(parsePagination("0", undefined).limit).toBe(50);
  expect(parsePagination("-5", undefined).limit).toBe(50);
});

test("falls back to offset 0 for a non-numeric or negative value", () => {
  expect(parsePagination(undefined, "not-a-number").offset).toBe(0);
  expect(parsePagination(undefined, "-10").offset).toBe(0);
});

test("truncates a fractional limit/offset rather than passing a float through to a query", () => {
  expect(parsePagination("10.7", "5.9")).toEqual({ limit: 10, offset: 5 });
});

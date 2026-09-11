import { corsOrigins } from "./cors";

const ORIGINAL_ENV = process.env.CORS_ORIGIN;

afterEach(() => {
  if (ORIGINAL_ENV === undefined) delete process.env.CORS_ORIGIN;
  else process.env.CORS_ORIGIN = ORIGINAL_ENV;
});

test("returns undefined when CORS_ORIGIN is unset — CORS stays off by default, not opened to a guessed default", () => {
  delete process.env.CORS_ORIGIN;
  expect(corsOrigins()).toBeUndefined();
});

test("returns undefined when CORS_ORIGIN is set but empty/whitespace-only", () => {
  process.env.CORS_ORIGIN = "   ";
  expect(corsOrigins()).toBeUndefined();
});

test("parses a single real origin", () => {
  process.env.CORS_ORIGIN = "https://app.mytrima.co.ls";
  expect(corsOrigins()).toEqual(["https://app.mytrima.co.ls"]);
});

test("parses multiple comma-separated origins, trimming whitespace", () => {
  process.env.CORS_ORIGIN = "https://app.mytrima.co.ls, http://localhost:5173 ,https://staging.mytrima.co.ls";
  expect(corsOrigins()).toEqual(["https://app.mytrima.co.ls", "http://localhost:5173", "https://staging.mytrima.co.ls"]);
});

test("drops empty entries from trailing/double commas", () => {
  process.env.CORS_ORIGIN = "https://app.mytrima.co.ls,,";
  expect(corsOrigins()).toEqual(["https://app.mytrima.co.ls"]);
});

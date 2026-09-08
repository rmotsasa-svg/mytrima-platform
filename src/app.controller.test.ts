import { AppController } from "./app.controller";
import type { Response } from "express";

/** Minimal fake Express response capturing what the controller sent,
 * mirroring the fake-response pattern in http-exception.filter.test.ts. */
function makeFakeResponse(): { body?: string } & Response {
  const res: { body?: string; type: (t: string) => typeof res; send: (b: string) => typeof res } = {
    type() {
      return res;
    },
    send(b: string) {
      res.body = b;
      return res;
    },
  };
  return res as unknown as { body?: string } & Response;
}

/**
 * Regression test for a real bug caught only by actually opening the
 * dashboard in a browser: the "MFA Enrollment" / rating-notification work
 * added `'\n'` inside a JS string literal that itself lives inside
 * DASHBOARD_HTML's outer TypeScript template literal. A template literal
 * interprets `\n` as a real newline character at compile time — not a
 * literal two-character escape sequence — so the *output* HTML had an
 * actual line break splitting a single-quoted string in two, breaking the
 * entire inline `<script>` with a SyntaxError. Nothing in `npm test` could
 * have caught this: the dashboard's script is never parsed, only ever
 * string-concatenated, by any other test. This test would have failed the
 * moment that bug was introduced.
 */
test("the dashboard's inline <script> is at least syntactically valid JavaScript", () => {
  const controller = new AppController();
  const res = makeFakeResponse();
  controller.dashboard(res);

  const html = res.body!;
  const scriptMatch = html.match(/<script>([\s\S]*)<\/script>/);
  expect(scriptMatch).not.toBeNull();

  const script = scriptMatch![1];
  expect(() => new Function(script)).not.toThrow();
});

test("the dashboard response is a full HTML document naming the app", () => {
  const controller = new AppController();
  const res = makeFakeResponse();
  controller.dashboard(res);

  expect(res.body).toContain("<!doctype html>");
  expect(res.body).toContain("Mytrima");
});

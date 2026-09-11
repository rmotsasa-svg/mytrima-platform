import { validate } from "class-validator";
import { plainToInstance } from "class-transformer";
import { RequestBookingBody } from "../modules/booking/booking.controller";
import { SubmitRatingBody } from "../modules/reputation/rating.controller";
import { SubmitNpsBody } from "../modules/growth-audit/nps.controller";
import { CreateSupportTicketBody } from "../modules/support/support-ticket.controller";
import { ResolveSupportTicketBody } from "../modules/admin/admin.controller";

/**
 * Real tests against the actual DTO classes the global ValidationPipe
 * (main.ts) validates every request body against — not a mock of
 * class-validator's behavior. `plainToInstance` + `validate()` here is
 * exactly what `ValidationPipe` calls internally, so a class that passes/
 * fails here passes/fails identically over real HTTP. Converted 2026-09-11
 * to close the real gap the Platform Readiness Assessment flagged, and the
 * exact bug class already found live in the Support Ticket module: a body
 * missing/malformed at the HTTP boundary now gets a clean 400 here, before
 * ever reaching a service's own `.trim()`/similar assumption.
 */

test("RequestBookingBody rejects a genuinely missing customerId/catalogItemId/scheduledAt", async () => {
  const body = plainToInstance(RequestBookingBody, {});
  const errors = await validate(body);
  const properties = errors.map((e) => e.property);
  expect(properties).toEqual(expect.arrayContaining(["customerId", "catalogItemId", "scheduledAt"]));
});

test("RequestBookingBody rejects a non-ISO8601 scheduledAt and a non-positive durationMinutes", async () => {
  const body = plainToInstance(RequestBookingBody, {
    customerId: "c1",
    catalogItemId: "i1",
    scheduledAt: "not-a-date",
    durationMinutes: -30,
  });
  const errors = await validate(body);
  const properties = errors.map((e) => e.property);
  expect(properties).toEqual(expect.arrayContaining(["scheduledAt", "durationMinutes"]));
});

test("RequestBookingBody accepts a real, well-formed request", async () => {
  const body = plainToInstance(RequestBookingBody, {
    customerId: "c1",
    catalogItemId: "i1",
    scheduledAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    durationMinutes: 60,
    notes: "First time customer",
  });
  const errors = await validate(body);
  expect(errors).toHaveLength(0);
});

test("SubmitRatingBody rejects stars outside 1-5 and a missing customerId", async () => {
  const body = plainToInstance(SubmitRatingBody, { tenantId: "t1", stars: 7 });
  const errors = await validate(body);
  const properties = errors.map((e) => e.property);
  expect(properties).toEqual(expect.arrayContaining(["customerId", "stars"]));
});

test("SubmitRatingBody accepts a real, well-formed submission", async () => {
  const body = plainToInstance(SubmitRatingBody, { tenantId: "t1", customerId: "c1", stars: 5, comment: "Great service" });
  const errors = await validate(body);
  expect(errors).toHaveLength(0);
});

test("SubmitNpsBody rejects a score outside 0-10", async () => {
  const body = plainToInstance(SubmitNpsBody, { tenantId: "t1", customerId: "c1", score: 11 });
  const errors = await validate(body);
  expect(errors.some((e) => e.property === "score")).toBe(true);
});

test("SubmitNpsBody accepts a real, well-formed submission with no comment", async () => {
  const body = plainToInstance(SubmitNpsBody, { tenantId: "t1", customerId: "c1", score: 9 });
  const errors = await validate(body);
  expect(errors).toHaveLength(0);
});

test("CreateSupportTicketBody rejects a genuinely empty subject/description and an invalid severity", async () => {
  const body = plainToInstance(CreateSupportTicketBody, { subject: "", description: "", severity: "urgent" });
  const errors = await validate(body);
  const properties = errors.map((e) => e.property);
  expect(properties).toEqual(expect.arrayContaining(["subject", "description", "severity"]));
});

// Real finding writing this test suite: class-validator's @IsNotEmpty()
// only rejects the literal empty string "" — a whitespace-only "  " passes
// DTO-level validation cleanly. That's not a gap in practice: this exact
// field still gets rejected downstream by SupportTicketService.create()'s
// own `!subject.trim()` check (see support-ticket.service.test.ts) — this
// test documents that split responsibility rather than asserting the DTO
// catches something it structurally can't without a custom validator.
test("CreateSupportTicketBody's DTO-level check does not catch a whitespace-only subject — that's the service layer's job", async () => {
  const body = plainToInstance(CreateSupportTicketBody, { subject: "   ", description: "Real description" });
  const errors = await validate(body);
  expect(errors).toHaveLength(0);
});

test("CreateSupportTicketBody accepts a real ticket with no severity given", async () => {
  const body = plainToInstance(CreateSupportTicketBody, { subject: "Checkout is down", description: "500 on every page" });
  const errors = await validate(body);
  expect(errors).toHaveLength(0);
});

test("ResolveSupportTicketBody rejects the exact genuinely-omitted-field shape that caused the real 500 bug this session", async () => {
  const body = plainToInstance(ResolveSupportTicketBody, {});
  const errors = await validate(body);
  expect(errors.some((e) => e.property === "resolutionNotes")).toBe(true);
});

test("ResolveSupportTicketBody accepts a real resolution note", async () => {
  const body = plainToInstance(ResolveSupportTicketBody, { resolutionNotes: "Restarted the affected service; confirmed fixed." });
  const errors = await validate(body);
  expect(errors).toHaveLength(0);
});

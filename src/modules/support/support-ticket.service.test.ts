import { randomUUID } from "node:crypto";
import {
  SupportTicketService,
  InvalidSupportTicketError,
  SupportTicketNotFoundError,
  InvalidSupportTicketStatusTransitionError,
} from "./support-ticket.service";
import { InMemorySupportTicketStore } from "./in-memory-support-ticket.store";

function makeService(): SupportTicketService {
  return new SupportTicketService(new InMemorySupportTicketStore());
}

test("create persists a ticket in 'open' status, defaulting severity to 'normal'", async () => {
  const service = makeService();
  const ticket = await service.create("t1", randomUUID(), "u1", "Payments page is blank", "Nothing loads at all on Chrome.");
  expect(ticket.status).toBe("open");
  expect(ticket.severity).toBe("normal");
  expect(ticket.createdByUserId).toBe("u1");
});

test("create accepts an explicit severity", async () => {
  const service = makeService();
  const ticket = await service.create("t1", randomUUID(), "u1", "Site is down", "500 on every page", "critical");
  expect(ticket.severity).toBe("critical");
});

test("create rejects an invalid severity", async () => {
  const service = makeService();
  await expect(
    service.create("t1", randomUUID(), "u1", "Subject", "Description", "urgent" as never)
  ).rejects.toThrow(InvalidSupportTicketError);
});

test("create rejects an empty subject or description", async () => {
  const service = makeService();
  await expect(service.create("t1", randomUUID(), "u1", "  ", "Real description")).rejects.toThrow(InvalidSupportTicketError);
  await expect(service.create("t1", randomUUID(), "u1", "Real subject", "  ")).rejects.toThrow(InvalidSupportTicketError);
});

test("listForTenant is tenant-scoped", async () => {
  const service = makeService();
  await service.create("t1", randomUUID(), "u1", "T1 issue", "Description");
  await service.create("t2", randomUUID(), "u2", "T2 issue", "Description");
  const list = await service.listForTenant("t1");
  expect(list).toHaveLength(1);
  expect(list[0].subject).toBe("T1 issue");
});

test("the real operator lifecycle: open -> in_progress -> resolved, with required resolutionNotes", async () => {
  const service = makeService();
  const ticket = await service.create("t1", randomUUID(), "u1", "Subject", "Description");

  const inProgress = await service.markInProgress("t1", ticket.id);
  expect(inProgress.status).toBe("in_progress");

  const resolved = await service.resolve("t1", ticket.id, "Restarted the affected service; confirmed fixed.");
  expect(resolved.status).toBe("resolved");
  expect(resolved.resolutionNotes).toBe("Restarted the affected service; confirmed fixed.");
});

test("resolve can be called directly from 'open', skipping in_progress", async () => {
  const service = makeService();
  const ticket = await service.create("t1", randomUUID(), "u1", "Trivial typo", "Description");
  const resolved = await service.resolve("t1", ticket.id, "Fixed the typo in the next deploy.");
  expect(resolved.status).toBe("resolved");
});

test("resolve rejects an empty resolutionNotes — 'resolved' with no explanation isn't a real resolution", async () => {
  const service = makeService();
  const ticket = await service.create("t1", randomUUID(), "u1", "Subject", "Description");
  await expect(service.resolve("t1", ticket.id, "  ")).rejects.toThrow(InvalidSupportTicketError);
});

test("resolve rejects a genuinely omitted resolutionNotes (undefined, not just empty) — a real bug found live-testing this against a running server: undefined.trim() threw a raw TypeError instead of InvalidSupportTicketError", async () => {
  const service = makeService();
  const ticket = await service.create("t1", randomUUID(), "u1", "Subject", "Description");
  await expect(service.resolve("t1", ticket.id, undefined as unknown as string)).rejects.toThrow(InvalidSupportTicketError);
});

test("create rejects a genuinely omitted subject/description (undefined, not just empty) — same class of bug as the resolve() one above", async () => {
  const service = makeService();
  await expect(
    service.create("t1", randomUUID(), "u1", undefined as unknown as string, "Description")
  ).rejects.toThrow(InvalidSupportTicketError);
  await expect(
    service.create("t1", randomUUID(), "u1", "Subject", undefined as unknown as string)
  ).rejects.toThrow(InvalidSupportTicketError);
});

test("markInProgress rejects a ticket that is already resolved", async () => {
  const service = makeService();
  const ticket = await service.create("t1", randomUUID(), "u1", "Subject", "Description");
  await service.resolve("t1", ticket.id, "Fixed.");
  await expect(service.markInProgress("t1", ticket.id)).rejects.toThrow(InvalidSupportTicketStatusTransitionError);
});

test("reopen only applies to a resolved ticket, and keeps the prior resolutionNotes as history", async () => {
  const service = makeService();
  const ticket = await service.create("t1", randomUUID(), "u1", "Subject", "Description");
  await expect(service.reopen("t1", ticket.id)).rejects.toThrow(InvalidSupportTicketStatusTransitionError);

  await service.resolve("t1", ticket.id, "Tried restarting the service.");
  const reopened = await service.reopen("t1", ticket.id);
  expect(reopened.status).toBe("open");
  expect(reopened.resolutionNotes).toBe("Tried restarting the service.");
});

test("acting on an unknown ticket id throws SupportTicketNotFoundError", async () => {
  const service = makeService();
  await expect(service.markInProgress("t1", randomUUID())).rejects.toThrow(SupportTicketNotFoundError);
});

test("acting on another tenant's ticket id also throws SupportTicketNotFoundError, not a cross-tenant leak", async () => {
  const service = makeService();
  const ticket = await service.create("t1", randomUUID(), "u1", "Subject", "Description");
  await expect(service.markInProgress("t2", ticket.id)).rejects.toThrow(SupportTicketNotFoundError);
});

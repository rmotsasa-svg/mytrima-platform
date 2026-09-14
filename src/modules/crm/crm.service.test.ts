import { CrmService, InvalidLeadError, LeadNotFoundError } from "./crm.service";
import { InMemoryLeadStore } from "./in-memory-lead.store";
import { InMemoryCrmActivityStore } from "./in-memory-crm-activity.store";
import { CustomerService } from "../customers/customer.service";
import { InMemoryCustomerStore } from "../customers/in-memory-customer.store";
import { RatingService } from "../reputation/rating.service";
import { InMemoryRatingStore } from "../reputation/in-memory-rating.store";
import { ConsentService } from "../compliance/consent.service";
import { InMemoryConsentStore } from "../compliance/in-memory-consent.store";

function makeServices() {
  const customerService = new CustomerService(new InMemoryCustomerStore(), new RatingService(new InMemoryRatingStore()), new ConsentService(new InMemoryConsentStore()));
  const crmService = new CrmService(new InMemoryLeadStore(), new InMemoryCrmActivityStore(), customerService);
  return { crmService, customerService };
}

test("createLead persists a real lead starting in stage 'new'", async () => {
  const { crmService } = makeServices();
  const lead = await crmService.createLead("t1", "l1", { name: "Thabo's Bakery", source: "Facebook ad", contactPhone: "+26650000000" });
  expect(lead.stage).toBe("new");
  expect(lead.lastActivityAt).toEqual(lead.createdAt);
});

test("createLead rejects an empty name", async () => {
  const { crmService } = makeServices();
  await expect(crmService.createLead("t1", "l1", { name: "  ", source: "x" })).rejects.toThrow(InvalidLeadError);
});

test("createLead rejects a negative estimatedValue", async () => {
  const { crmService } = makeServices();
  await expect(crmService.createLead("t1", "l1", { name: "x", source: "y", estimatedValue: -5 })).rejects.toThrow(InvalidLeadError);
});

test("logActivity persists the activity and refreshes the lead's lastActivityAt", async () => {
  const { crmService } = makeServices();
  const lead = await crmService.createLead("t1", "l1", { name: "x", source: "y" });
  await new Promise((r) => setTimeout(r, 5));
  const activity = await crmService.logActivity("t1", lead.id, "a1", { type: "call", body: "Called, interested", createdByUserId: "u1" });
  expect(activity.body).toBe("Called, interested");
  const updated = await crmService.findById("t1", lead.id);
  expect(updated!.lastActivityAt.getTime()).toBeGreaterThan(lead.lastActivityAt.getTime());
});

test("logActivity on a nonexistent lead throws LeadNotFoundError", async () => {
  const { crmService } = makeServices();
  await expect(crmService.logActivity("t1", "no-such-id", "a1", { type: "note", body: "x", createdByUserId: "u1" })).rejects.toThrow(LeadNotFoundError);
});

test("listActivitiesForLead returns activities newest first", async () => {
  const { crmService } = makeServices();
  const lead = await crmService.createLead("t1", "l1", { name: "x", source: "y" });
  await crmService.logActivity("t1", lead.id, "a1", { type: "note", body: "first", createdByUserId: "u1" });
  // A real millisecond-resolution tie is possible for two calls this close
  // together — forced apart here so the ordering assertion below tests
  // real sort-by-createdAt behavior, not an accidental tie.
  await new Promise((r) => setTimeout(r, 5));
  await crmService.logActivity("t1", lead.id, "a2", { type: "note", body: "second", createdByUserId: "u1" });
  const activities = await crmService.listActivitiesForLead("t1", lead.id);
  expect(activities.map((a) => a.body)).toEqual(["second", "first"]);
});

test("moveStage to 'won' creates a real matching Customer when none exists", async () => {
  const { crmService, customerService } = makeServices();
  const lead = await crmService.createLead("t1", "l1", { name: "Thabo's Bakery", source: "Facebook ad", contactPhone: "+26650000000" });
  const won = await crmService.moveStage("t1", lead.id, "won");
  expect(won.stage).toBe("won");
  expect(won.wonCustomerId).toBeDefined();
  const customer = await customerService.findById("t1", won.wonCustomerId!);
  expect(customer?.phone).toBe("+26650000000");
});

test("moveStage to 'won' matches an existing Customer by phone instead of creating a duplicate", async () => {
  const { crmService, customerService } = makeServices();
  const existing = await customerService.create("t1", "c1", "Thabo", "+26650000000");
  const lead = await crmService.createLead("t1", "l1", { name: "Thabo's Bakery", source: "Facebook ad", contactPhone: "+26650000000" });
  const won = await crmService.moveStage("t1", lead.id, "won");
  expect(won.wonCustomerId).toBe(existing.id);
  expect(await customerService.listForTenant("t1")).toHaveLength(1); // no duplicate created
});

test("moveStage on a nonexistent lead throws LeadNotFoundError", async () => {
  const { crmService } = makeServices();
  await expect(crmService.moveStage("t1", "no-such-id", "qualified")).rejects.toThrow(LeadNotFoundError);
});

test("listForTenant never crosses tenants", async () => {
  const { crmService } = makeServices();
  await crmService.createLead("t1", "l1", { name: "x", source: "y" });
  await crmService.createLead("t2", "l2", { name: "x2", source: "y2" });
  expect(await crmService.listForTenant("t1")).toHaveLength(1);
});

import { CustomerService, InvalidCustomerError, CustomerNotFoundError } from "./customer.service";
import { InMemoryCustomerStore } from "./in-memory-customer.store";
import { RatingService } from "../reputation/rating.service";
import { InMemoryRatingStore } from "../reputation/in-memory-rating.store";
import { ConsentService } from "../compliance/consent.service";
import { InMemoryConsentStore } from "../compliance/in-memory-consent.store";

/** Real RatingService/ConsentService, backed by fresh in-memory stores each
 * call — CustomerService.getActivity() genuinely calls through to both, so a
 * mock here would only prove the mock was called, not that the aggregation
 * actually works against real (if in-memory) business logic. */
function makeService(store = new InMemoryCustomerStore()) {
  return new CustomerService(store, new RatingService(new InMemoryRatingStore()), new ConsentService(new InMemoryConsentStore()));
}

test("create saves a customer with only a display name", async () => {
  const service = makeService();
  const customer = await service.create("t1", "c1", "Thabo M.");
  expect(customer.displayName).toBe("Thabo M.");
  expect(customer.phone).toBeUndefined();
  expect(customer.email).toBeUndefined();
});

test("create saves a customer identified only by phone", async () => {
  const service = makeService();
  const customer = await service.create("t1", "c1", undefined, "+26650000000");
  expect(customer.phone).toBe("+26650000000");
});

test("create saves a customer identified only by email", async () => {
  const service = makeService();
  const customer = await service.create("t1", "c1", undefined, undefined, "customer@example.com");
  expect(customer.email).toBe("customer@example.com");
});

test("create rejects a customer with no identifying field at all", async () => {
  const service = makeService();
  await expect(service.create("t1", "c1")).rejects.toThrow(InvalidCustomerError);
  await expect(service.create("t1", "c1", "   ", "  ", "")).rejects.toThrow(InvalidCustomerError);
});

test("create trims whitespace-only fields down to undefined rather than storing blanks", async () => {
  const service = makeService();
  const customer = await service.create("t1", "c1", "  Real Name  ", "  ", "");
  expect(customer.displayName).toBe("Real Name");
  expect(customer.phone).toBeUndefined();
  expect(customer.email).toBeUndefined();
});

test("listForTenant is tenant-scoped: another tenant's customer does not appear", async () => {
  const service = makeService();
  await service.create("tenant-A", "c1", "A's customer");
  await service.create("tenant-B", "c2", "B's customer");
  const listA = await service.listForTenant("tenant-A");
  expect(listA).toHaveLength(1);
  expect(listA[0].displayName).toBe("A's customer");
});

test("listForTenant returns an empty array, not an error, when a tenant has no customers", async () => {
  const service = makeService();
  const list = await service.listForTenant("t1");
  expect(list).toEqual([]);
});

/* ---------- findById ---------- */

test("findById returns the customer when it exists for that tenant", async () => {
  const service = makeService();
  await service.create("t1", "c1", "Thabo M.");
  const found = await service.findById("t1", "c1");
  expect(found?.displayName).toBe("Thabo M.");
});

test("findById returns null for a wrong tenant or unknown id", async () => {
  const service = makeService();
  await service.create("tenant-A", "c1", "A's customer");
  expect(await service.findById("tenant-B", "c1")).toBeNull();
  expect(await service.findById("tenant-A", "no-such-id")).toBeNull();
});

/* ---------- update ---------- */

test("update changes the stored fields and returns the updated customer", async () => {
  const service = makeService();
  await service.create("t1", "c1", "Old Name", "+26650000000");
  const updated = await service.update("t1", "c1", "New Name", "+26650000001");
  expect(updated.displayName).toBe("New Name");
  expect(updated.phone).toBe("+26650000001");

  const refetched = await service.findById("t1", "c1");
  expect(refetched?.displayName).toBe("New Name");
});

test("update throws CustomerNotFoundError for a wrong tenant or unknown id", async () => {
  const service = makeService();
  await service.create("tenant-A", "c1", "A's customer");
  await expect(service.update("tenant-B", "c1", "Hijacked Name")).rejects.toThrow(CustomerNotFoundError);
  await expect(service.update("tenant-A", "no-such-id", "New Name")).rejects.toThrow(CustomerNotFoundError);
});

test("update rejects blanking out every identifying field, same rule as create", async () => {
  const service = makeService();
  await service.create("t1", "c1", "Real Name");
  await expect(service.update("t1", "c1", "", "", "")).rejects.toThrow(InvalidCustomerError);
  // The original value must survive a rejected update, not get partially applied.
  const unchanged = await service.findById("t1", "c1");
  expect(unchanged?.displayName).toBe("Real Name");
});

/**
 * Regression test for a real bug caught only by live-curling the running
 * server: the first working version of update() treated every call as a
 * full replace, so PATCHing just `displayName` silently wiped out an
 * existing `phone`/`email` the caller never mentioned. A field genuinely
 * left out of the call (`undefined`) must keep its existing value.
 */
test("update leaves fields the caller didn't mention untouched — a true partial update, not a replace", async () => {
  const service = makeService();
  await service.create("t1", "c1", "Original Name", "+26650000000", "original@example.com");

  const updated = await service.update("t1", "c1", "New Name"); // phone/email genuinely omitted
  expect(updated.displayName).toBe("New Name");
  expect(updated.phone).toBe("+26650000000");
  expect(updated.email).toBe("original@example.com");
});

test("update DOES clear a field when the caller explicitly sends an empty string for it", async () => {
  const service = makeService();
  await service.create("t1", "c1", "Real Name", "+26650000000");
  const updated = await service.update("t1", "c1", undefined, ""); // explicit clear, not omission
  expect(updated.displayName).toBe("Real Name"); // untouched
  expect(updated.phone).toBeUndefined(); // explicitly cleared
});

test("update rejects clearing the customer's only identifying field even via partial update", async () => {
  const service = makeService();
  await service.create("t1", "c1", undefined, "+26650000000"); // phone-only customer
  await expect(service.update("t1", "c1", undefined, "")).rejects.toThrow(InvalidCustomerError);
});

/* ---------- search ---------- */

test("search filters by a case-insensitive substring match on any identifying field", async () => {
  const service = makeService();
  await service.create("t1", "c1", "Thabo Molefe", "+26650000001");
  await service.create("t1", "c2", "Palesa Nkoe", "+26650000002", "palesa@example.com");

  expect(await service.search("t1", "thabo")).toHaveLength(1);
  expect(await service.search("t1", "PALESA")).toHaveLength(1);
  expect(await service.search("t1", "50000001")).toHaveLength(1);
  expect(await service.search("t1", "example.com")).toHaveLength(1);
  expect(await service.search("t1", "no-match-anywhere")).toHaveLength(0);
});

test("search with an empty query returns the full tenant list, same as listForTenant", async () => {
  const service = makeService();
  await service.create("t1", "c1", "A");
  await service.create("t1", "c2", "B");
  expect(await service.search("t1", "  ")).toHaveLength(2);
});

test("search is tenant-scoped: another tenant's matching customer does not appear", async () => {
  const service = makeService();
  await service.create("tenant-A", "c1", "Thabo Molefe");
  await service.create("tenant-B", "c2", "Thabo Also");
  expect(await service.search("tenant-A", "thabo")).toHaveLength(1);
});

/* ---------- getActivity ---------- */

test("getActivity aggregates a customer's own ratings and consent records, real data from real services", async () => {
  const store = new InMemoryCustomerStore();
  const ratingService = new RatingService(new InMemoryRatingStore());
  const consentService = new ConsentService(new InMemoryConsentStore());
  const service = new CustomerService(store, ratingService, consentService);

  await service.create("t1", "c1", "Thabo M.");
  await ratingService.submit("t1", "c1", 5, "r1", "Great!");
  await ratingService.submit("t1", "other-customer", 1, "r2"); // must not leak in
  await consentService.grant("t1", "c1", "whatsapp_marketing", "consent", "consent1");

  const activity = await service.getActivity("t1", "c1");
  expect(activity.customer.displayName).toBe("Thabo M.");
  expect(activity.ratings).toHaveLength(1);
  expect(activity.ratings[0].id).toBe("r1");
  expect(activity.consentRecords).toHaveLength(1);
  expect(activity.consentRecords[0].dataCategory).toBe("whatsapp_marketing");
});

test("getActivity includes a customer's pending/hidden ratings too, not just public ones", async () => {
  const store = new InMemoryCustomerStore();
  const ratingService = new RatingService(new InMemoryRatingStore());
  const consentService = new ConsentService(new InMemoryConsentStore());
  const service = new CustomerService(store, ratingService, consentService);

  await service.create("t1", "c1", "Thabo M.");
  await ratingService.submit("t1", "c1", 2, "r1"); // left pending, never moderated

  const activity = await service.getActivity("t1", "c1");
  expect(activity.ratings).toHaveLength(1);
  expect(activity.ratings[0].status).toBe("pending");
});

test("getActivity throws CustomerNotFoundError for a wrong tenant or unknown id", async () => {
  const service = makeService();
  await service.create("tenant-A", "c1", "A's customer");
  await expect(service.getActivity("tenant-B", "c1")).rejects.toThrow(CustomerNotFoundError);
  await expect(service.getActivity("tenant-A", "no-such-id")).rejects.toThrow(CustomerNotFoundError);
});

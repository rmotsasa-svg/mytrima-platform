import { randomUUID } from "node:crypto";
import {
  BookingService,
  InvalidBookingError,
  BookingNotFoundError,
  BookingConflictError,
  InvalidBookingStatusTransitionError,
} from "./booking.service";
import { InMemoryBookingStore } from "./in-memory-booking.store";
import { CatalogService } from "../catalog/catalog-item.service";
import { InMemoryCatalogItemStore } from "../catalog/in-memory-catalog-item.store";
import { CustomerService, CustomerNotFoundError } from "../customers/customer.service";
import { InMemoryCustomerStore } from "../customers/in-memory-customer.store";
import { RatingService } from "../reputation/rating.service";
import { InMemoryRatingStore } from "../reputation/in-memory-rating.store";
import { ConsentService } from "../compliance/consent.service";
import { InMemoryConsentStore } from "../compliance/in-memory-consent.store";

/** Real service instances throughout (only the stores are in-memory) —
 * same discipline as every other integration-style test in this codebase. */
function makeServices() {
  const catalogService = new CatalogService(new InMemoryCatalogItemStore());
  const ratingService = new RatingService(new InMemoryRatingStore());
  const consentService = new ConsentService(new InMemoryConsentStore());
  const customerService = new CustomerService(new InMemoryCustomerStore(), ratingService, consentService);
  const bookingService = new BookingService(new InMemoryBookingStore(), catalogService, customerService);
  return { bookingService, catalogService, customerService };
}

async function makeServiceItem(catalogService: CatalogService, tenantId: string, durationMinutes?: number) {
  return catalogService.create(tenantId, randomUUID(), "Haircut", "service", 150, undefined, durationMinutes);
}

async function makeCustomer(customerService: CustomerService, tenantId: string) {
  return customerService.create(tenantId, randomUUID(), "Nomvula", "+26650000000", undefined);
}

const inOneHour = () => new Date(Date.now() + 60 * 60 * 1000);
const inTwoHours = () => new Date(Date.now() + 2 * 60 * 60 * 1000);

test("requestBooking creates a real booking in 'requested' status, using the catalog item's own default duration", async () => {
  const { bookingService, catalogService, customerService } = makeServices();
  const item = await makeServiceItem(catalogService, "t1", 60);
  const customer = await makeCustomer(customerService, "t1");

  const booking = await bookingService.requestBooking("t1", randomUUID(), {
    customerId: customer.id,
    catalogItemId: item.id,
    scheduledAt: inOneHour(),
  });

  expect(booking.status).toBe("requested");
  expect(booking.durationMinutes).toBe(60);
});

test("requestBooking rejects an unknown customer", async () => {
  const { bookingService, catalogService } = makeServices();
  const item = await makeServiceItem(catalogService, "t1", 60);
  await expect(
    bookingService.requestBooking("t1", randomUUID(), { customerId: randomUUID(), catalogItemId: item.id, scheduledAt: inOneHour() })
  ).rejects.toThrow(CustomerNotFoundError);
});

test("requestBooking rejects a catalog item that is a product, not a service", async () => {
  const { bookingService, catalogService, customerService } = makeServices();
  const product = await catalogService.create("t1", randomUUID(), "Shampoo bottle", "product", 80);
  const customer = await makeCustomer(customerService, "t1");
  await expect(
    bookingService.requestBooking("t1", randomUUID(), { customerId: customer.id, catalogItemId: product.id, scheduledAt: inOneHour() })
  ).rejects.toThrow(InvalidBookingError);
});

test("requestBooking rejects a service with no duration set and none given", async () => {
  const { bookingService, catalogService, customerService } = makeServices();
  const item = await makeServiceItem(catalogService, "t1"); // no durationMinutes
  const customer = await makeCustomer(customerService, "t1");
  await expect(
    bookingService.requestBooking("t1", randomUUID(), { customerId: customer.id, catalogItemId: item.id, scheduledAt: inOneHour() })
  ).rejects.toThrow(InvalidBookingError);
});

test("requestBooking accepts an explicit durationMinutes overriding the catalog item's own default", async () => {
  const { bookingService, catalogService, customerService } = makeServices();
  const item = await makeServiceItem(catalogService, "t1", 60);
  const customer = await makeCustomer(customerService, "t1");
  const booking = await bookingService.requestBooking("t1", randomUUID(), {
    customerId: customer.id,
    catalogItemId: item.id,
    scheduledAt: inOneHour(),
    durationMinutes: 90,
  });
  expect(booking.durationMinutes).toBe(90);
});

test("requestBooking rejects a time in the past", async () => {
  const { bookingService, catalogService, customerService } = makeServices();
  const item = await makeServiceItem(catalogService, "t1", 60);
  const customer = await makeCustomer(customerService, "t1");
  await expect(
    bookingService.requestBooking("t1", randomUUID(), { customerId: customer.id, catalogItemId: item.id, scheduledAt: new Date("2020-01-01") })
  ).rejects.toThrow(InvalidBookingError);
});

test("requestBooking rejects a real overlapping time against an existing requested booking", async () => {
  const { bookingService, catalogService, customerService } = makeServices();
  const item = await makeServiceItem(catalogService, "t1", 60);
  const customer = await makeCustomer(customerService, "t1");
  const start = inOneHour();
  await bookingService.requestBooking("t1", randomUUID(), { customerId: customer.id, catalogItemId: item.id, scheduledAt: start });

  // 30 minutes into the first booking's 60-minute slot -> a real overlap.
  const overlappingStart = new Date(start.getTime() + 30 * 60 * 1000);
  await expect(
    bookingService.requestBooking("t1", randomUUID(), { customerId: customer.id, catalogItemId: item.id, scheduledAt: overlappingStart })
  ).rejects.toThrow(BookingConflictError);
});

test("requestBooking allows a back-to-back booking that does not actually overlap", async () => {
  const { bookingService, catalogService, customerService } = makeServices();
  const item = await makeServiceItem(catalogService, "t1", 60);
  const customer = await makeCustomer(customerService, "t1");
  const start = inOneHour();
  await bookingService.requestBooking("t1", randomUUID(), { customerId: customer.id, catalogItemId: item.id, scheduledAt: start });

  const backToBackStart = new Date(start.getTime() + 60 * 60 * 1000); // exactly when the first ends
  const second = await bookingService.requestBooking("t1", randomUUID(), {
    customerId: customer.id,
    catalogItemId: item.id,
    scheduledAt: backToBackStart,
  });
  expect(second.status).toBe("requested");
});

test("requestBooking is tenant-scoped — an overlapping time in a different tenant is not a conflict", async () => {
  const { bookingService, catalogService, customerService } = makeServices();
  const itemT1 = await makeServiceItem(catalogService, "t1", 60);
  const itemT2 = await makeServiceItem(catalogService, "t2", 60);
  const custT1 = await makeCustomer(customerService, "t1");
  const custT2 = await makeCustomer(customerService, "t2");
  const start = inOneHour();
  await bookingService.requestBooking("t1", randomUUID(), { customerId: custT1.id, catalogItemId: itemT1.id, scheduledAt: start });

  const second = await bookingService.requestBooking("t2", randomUUID(), { customerId: custT2.id, catalogItemId: itemT2.id, scheduledAt: start });
  expect(second.status).toBe("requested");
});

test("a cancelled booking's slot becomes available again", async () => {
  const { bookingService, catalogService, customerService } = makeServices();
  const item = await makeServiceItem(catalogService, "t1", 60);
  const customer = await makeCustomer(customerService, "t1");
  const start = inOneHour();
  const first = await bookingService.requestBooking("t1", randomUUID(), { customerId: customer.id, catalogItemId: item.id, scheduledAt: start });
  await bookingService.cancel("t1", first.id);

  const second = await bookingService.requestBooking("t1", randomUUID(), { customerId: customer.id, catalogItemId: item.id, scheduledAt: start });
  expect(second.status).toBe("requested");
});

test("the full real status lifecycle: requested -> confirmed -> completed", async () => {
  const { bookingService, catalogService, customerService } = makeServices();
  const item = await makeServiceItem(catalogService, "t1", 60);
  const customer = await makeCustomer(customerService, "t1");
  const booking = await bookingService.requestBooking("t1", randomUUID(), { customerId: customer.id, catalogItemId: item.id, scheduledAt: inOneHour() });

  const confirmed = await bookingService.confirm("t1", booking.id);
  expect(confirmed.status).toBe("confirmed");

  const completed = await bookingService.complete("t1", booking.id);
  expect(completed.status).toBe("completed");
});

test("cannot complete a booking that was never confirmed", async () => {
  const { bookingService, catalogService, customerService } = makeServices();
  const item = await makeServiceItem(catalogService, "t1", 60);
  const customer = await makeCustomer(customerService, "t1");
  const booking = await bookingService.requestBooking("t1", randomUUID(), { customerId: customer.id, catalogItemId: item.id, scheduledAt: inOneHour() });
  await expect(bookingService.complete("t1", booking.id)).rejects.toThrow(InvalidBookingStatusTransitionError);
});

test("cannot cancel an already-completed booking", async () => {
  const { bookingService, catalogService, customerService } = makeServices();
  const item = await makeServiceItem(catalogService, "t1", 60);
  const customer = await makeCustomer(customerService, "t1");
  const booking = await bookingService.requestBooking("t1", randomUUID(), { customerId: customer.id, catalogItemId: item.id, scheduledAt: inOneHour() });
  await bookingService.confirm("t1", booking.id);
  await bookingService.complete("t1", booking.id);
  await expect(bookingService.cancel("t1", booking.id)).rejects.toThrow(InvalidBookingStatusTransitionError);
});

test("markNoShow only applies to a confirmed booking", async () => {
  const { bookingService, catalogService, customerService } = makeServices();
  const item = await makeServiceItem(catalogService, "t1", 60);
  const customer = await makeCustomer(customerService, "t1");
  const booking = await bookingService.requestBooking("t1", randomUUID(), { customerId: customer.id, catalogItemId: item.id, scheduledAt: inOneHour() });
  await expect(bookingService.markNoShow("t1", booking.id)).rejects.toThrow(InvalidBookingStatusTransitionError);

  await bookingService.confirm("t1", booking.id);
  const noShow = await bookingService.markNoShow("t1", booking.id);
  expect(noShow.status).toBe("no_show");
});

test("acting on an unknown booking id throws BookingNotFoundError", async () => {
  const { bookingService } = makeServices();
  await expect(bookingService.confirm("t1", randomUUID())).rejects.toThrow(BookingNotFoundError);
});

test("listForTenant is tenant-scoped and period-filterable", async () => {
  const { bookingService, catalogService, customerService } = makeServices();
  const item = await makeServiceItem(catalogService, "t1", 60);
  const customer = await makeCustomer(customerService, "t1");
  await bookingService.requestBooking("t1", randomUUID(), { customerId: customer.id, catalogItemId: item.id, scheduledAt: inOneHour() });
  await bookingService.requestBooking("t1", randomUUID(), { customerId: customer.id, catalogItemId: item.id, scheduledAt: inTwoHours() });

  const all = await bookingService.listForTenant("t1");
  expect(all).toHaveLength(2);

  const onlyLater = await bookingService.listForTenant("t1", new Date(inOneHour().getTime() + 30 * 60 * 1000));
  expect(onlyLater).toHaveLength(1);
});

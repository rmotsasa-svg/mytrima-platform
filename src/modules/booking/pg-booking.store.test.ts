import { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { BookingService } from "./booking.service";
import { PgBookingStore } from "./pg-booking.store";
import { CatalogService } from "../catalog/catalog-item.service";
import { PgCatalogItemStore } from "../catalog/pg-catalog-item.store";
import { RatingService } from "../reputation/rating.service";
import { PgRatingStore } from "../reputation/pg-rating.store";
import { ConsentService } from "../compliance/consent.service";
import { PgConsentStore } from "../compliance/pg-consent.store";
import { CustomerService } from "../customers/customer.service";
import { PgCustomerStore } from "../customers/pg-customer.store";
import { runWithTenantContext } from "../../common/postgres";

/**
 * REAL integration test against a live PostgreSQL instance — gated behind
 * TEST_DATABASE_URL, same as every other pg store test here. Exercises the
 * real `booking` table (0020_booking.sql) and its real foreign keys against
 * a real `customer` and `catalog_item` row, plus the RLS-tenant-context
 * lesson this codebase already learned once (recommendation.service.ts's
 * markDetected()): the confirm() status-transition UPDATE below must run
 * inside runWithTenantContext or RLS silently matches zero rows.
 */
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const maybeDescribe = TEST_DATABASE_URL ? describe : describe.skip;

maybeDescribe("PgBookingStore + BookingService against a real PostgreSQL instance", () => {
  const pool = new Pool({ connectionString: TEST_DATABASE_URL });
  const catalogService = new CatalogService(new PgCatalogItemStore(pool));
  const ratingService = new RatingService(new PgRatingStore(pool));
  const consentService = new ConsentService(new PgConsentStore(pool));
  const customerService = new CustomerService(new PgCustomerStore(pool), ratingService, consentService);
  const bookingService = new BookingService(new PgBookingStore(pool), catalogService, customerService);
  const tenantId = randomUUID();

  beforeAll(async () => {
    await pool.query("insert into tenant (id, name) values ($1, 'PgBookingStore test tenant')", [tenantId]);
  });

  afterAll(async () => {
    await runWithTenantContext(pool, tenantId, (client) => client.query("delete from tenant where id = $1", [tenantId]));
    await pool.end();
  });

  test("requestBooking persists a real row against real customer/catalog_item foreign keys, and confirm() really updates it under RLS", async () => {
    const item = await catalogService.create(tenantId, randomUUID(), "Real Haircut", "service", 150, undefined, 60);
    const customer = await customerService.create(tenantId, randomUUID(), "Real Customer", "+26650000000");

    const booking = await bookingService.requestBooking(tenantId, randomUUID(), {
      customerId: customer.id,
      catalogItemId: item.id,
      scheduledAt: new Date(Date.now() + 60 * 60 * 1000),
    });
    expect(booking.status).toBe("requested");

    const confirmed = await bookingService.confirm(tenantId, booking.id);
    expect(confirmed.status).toBe("confirmed");

    const reread = await bookingService.findById(tenantId, booking.id);
    expect(reread?.status).toBe("confirmed");
  });

  test("listForTenant is tenant-scoped, enforced by RLS", async () => {
    const otherTenantId = randomUUID();
    await pool.query("insert into tenant (id, name) values ($1, 'other tenant')", [otherTenantId]);
    const otherItem = await catalogService.create(otherTenantId, randomUUID(), "Other Haircut", "service", 100, undefined, 30);
    const otherCustomer = await customerService.create(otherTenantId, randomUUID(), "Other Customer");
    await bookingService.requestBooking(otherTenantId, randomUUID(), {
      customerId: otherCustomer.id,
      catalogItemId: otherItem.id,
      scheduledAt: new Date(Date.now() + 60 * 60 * 1000),
    });

    const list = await bookingService.listForTenant(tenantId);
    expect(list.every((b) => b.tenantId === tenantId)).toBe(true);

    await runWithTenantContext(pool, otherTenantId, (client) => client.query("delete from tenant where id = $1", [otherTenantId]));
  });
});

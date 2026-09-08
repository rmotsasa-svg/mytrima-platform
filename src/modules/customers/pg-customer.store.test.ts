import { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { CustomerService, CustomerNotFoundError } from "./customer.service";
import { PgCustomerStore } from "./pg-customer.store";
import { runWithTenantContext } from "../../common/postgres";
import { RatingService } from "../reputation/rating.service";
import { PgRatingStore } from "../reputation/pg-rating.store";
import { ConsentService } from "../compliance/consent.service";
import { PgConsentStore } from "../compliance/pg-consent.store";

/**
 * REAL integration test against a live PostgreSQL instance — gated behind
 * TEST_DATABASE_URL. See src/common/postgres.test.ts for the connection
 * requirements. This is the store whose absence was the actual, concrete
 * cause of the "rating_customer_id_fkey" failure documented in the README —
 * proving this store closes that gap for real, not just in theory.
 */
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const maybeDescribe = TEST_DATABASE_URL ? describe : describe.skip;

maybeDescribe("PgCustomerStore + CustomerService against a real PostgreSQL instance", () => {
  const pool = new Pool({ connectionString: TEST_DATABASE_URL });
  const ratingService = new RatingService(new PgRatingStore(pool));
  const consentService = new ConsentService(new PgConsentStore(pool));
  const service = new CustomerService(new PgCustomerStore(pool), ratingService, consentService);
  const tenantId = randomUUID();

  beforeAll(async () => {
    await pool.query("insert into tenant (id, name) values ($1, 'PgCustomerStore test tenant')", [tenantId]);
  });

  afterAll(async () => {
    // runWithTenantContext — this DELETE cascades into RLS-protected
    // customer rows on a connection that has run set_config() before; see
    // postgres.ts's comment on the empty-string-after-commit footgun a
    // plain pool.query() would hit here.
    await runWithTenantContext(pool, tenantId, (client) => client.query("delete from tenant where id = $1", [tenantId]));
    await pool.end();
  });

  test("create persists a real customer row, satisfying rating's foreign key", async () => {
    const customer = await service.create(tenantId, randomUUID(), "Real Customer", "+26650000001");
    const list = await service.listForTenant(tenantId);
    expect(list.find((c) => c.id === customer.id)?.displayName).toBe("Real Customer");
  });

  test("listForTenant is tenant-scoped, enforced by RLS", async () => {
    const otherTenantId = randomUUID();
    await pool.query("insert into tenant (id, name) values ($1, 'other tenant')", [otherTenantId]);
    await service.create(otherTenantId, randomUUID(), "Other tenant's customer");

    const list = await service.listForTenant(tenantId);
    expect(list.some((c) => c.displayName === "Other tenant's customer")).toBe(false);

    await runWithTenantContext(pool, otherTenantId, (client) => client.query("delete from tenant where id = $1", [otherTenantId]));
  });

  test("a customer created here actually satisfies rating.customer_id's foreign key", async () => {
    const customer = await service.create(tenantId, randomUUID(), "Ratable customer");
    // No try/catch: if the FK constraint rejected this insert, the test fails loudly.
    // runWithTenantContext (not a plain pool.query) — RLS's WITH CHECK clause
    // rejects an insert with no app.current_tenant_id set, same lesson learned
    // the hard way in pg-consent.store.test.ts's beforeAll.
    await runWithTenantContext(pool, tenantId, (client) =>
      client.query(
        `insert into rating (id, tenant_id, customer_id, stars, status, submitted_at) values ($1, $2, $3, 4, 'pending', now())`,
        [randomUUID(), tenantId, customer.id]
      )
    );
  });

  test("findById returns the real row, and null for a wrong tenant or unknown id", async () => {
    const customer = await service.create(tenantId, randomUUID(), "Findable customer");
    expect((await service.findById(tenantId, customer.id))?.displayName).toBe("Findable customer");

    const otherTenantId = randomUUID();
    await pool.query("insert into tenant (id, name) values ($1, 'other tenant for findById')", [otherTenantId]);
    expect(await service.findById(otherTenantId, customer.id)).toBeNull();
    await runWithTenantContext(pool, otherTenantId, (client) => client.query("delete from tenant where id = $1", [otherTenantId]));
  });

  test("update persists real changes to the row, and throws CustomerNotFoundError for a wrong tenant", async () => {
    const customer = await service.create(tenantId, randomUUID(), "Original Name");
    const updated = await service.update(tenantId, customer.id, "Updated Name", "+26650009999");
    expect(updated.displayName).toBe("Updated Name");

    const refetched = await service.findById(tenantId, customer.id);
    expect(refetched?.displayName).toBe("Updated Name");
    expect(refetched?.phone).toBe("+26650009999");

    const otherTenantId = randomUUID();
    await pool.query("insert into tenant (id, name) values ($1, 'other tenant for update')", [otherTenantId]);
    await expect(service.update(otherTenantId, customer.id, "Hijacked")).rejects.toThrow(CustomerNotFoundError);
    await runWithTenantContext(pool, otherTenantId, (client) => client.query("delete from tenant where id = $1", [otherTenantId]));
  });

  /**
   * Regression test for a real bug caught live-curling the running server:
   * PATCHing just `displayName` silently wiped a real `phone` column to
   * NULL in the database, because the first working version of update()
   * unconditionally overwrote every field on every call.
   */
  test("update leaves an unspecified field's real database column untouched", async () => {
    const customer = await service.create(tenantId, randomUUID(), "Has Phone", "+26650008888");
    await service.update(tenantId, customer.id, "Has Phone Renamed"); // phone genuinely omitted

    const refetched = await service.findById(tenantId, customer.id);
    expect(refetched?.displayName).toBe("Has Phone Renamed");
    expect(refetched?.phone).toBe("+26650008888"); // must survive, not become null
  });

  test("search filters real rows by a case-insensitive substring, tenant-scoped", async () => {
    await service.create(tenantId, randomUUID(), "Searchable Molefe", "+26650001111");
    await service.create(tenantId, randomUUID(), "Unrelated Person");

    const results = await service.search(tenantId, "molefe");
    expect(results.some((c) => c.displayName === "Searchable Molefe")).toBe(true);
    expect(results.some((c) => c.displayName === "Unrelated Person")).toBe(false);
  });

  /**
   * The actual end-to-end proof this "customer activity" view exists for:
   * a real customer, a real rating, and a real consent record, all against
   * the live database, assembled by getActivity() into one response — the
   * same real RatingService/ConsentService instances the app's own
   * CustomerModule would inject, not mocks standing in for them.
   */
  test("getActivity aggregates real ratings and consent records for a real customer", async () => {
    const customer = await service.create(tenantId, randomUUID(), "Activity Customer");
    await ratingService.submit(tenantId, customer.id, 5, randomUUID(), "Excellent");
    await consentService.grant(tenantId, customer.id, "whatsapp_marketing", "consent", randomUUID());

    const activity = await service.getActivity(tenantId, customer.id);
    expect(activity.customer.id).toBe(customer.id);
    expect(activity.ratings).toHaveLength(1);
    expect(activity.ratings[0].stars).toBe(5);
    expect(activity.consentRecords).toHaveLength(1);
    expect(activity.consentRecords[0].dataCategory).toBe("whatsapp_marketing");
  });
});

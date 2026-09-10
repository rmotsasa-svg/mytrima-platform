import { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { PgPayfastItnLogStore } from "./pg-payfast-itn-log.store";
import { runWithTenantContext } from "../../common/postgres";

/**
 * REAL integration test against a live PostgreSQL instance — gated behind
 * TEST_DATABASE_URL, same pattern as every other Pg*Store test in this
 * project. Proves a real jsonb round-trip of the raw ITN payload and real
 * RLS tenant scoping on payfast_itn_log (migration 0015_payfast.sql).
 */
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const maybeDescribe = TEST_DATABASE_URL ? describe : describe.skip;

maybeDescribe("PgPayfastItnLogStore against a real PostgreSQL instance", () => {
  const pool = new Pool({ connectionString: TEST_DATABASE_URL });
  const store = new PgPayfastItnLogStore(pool);
  const tenantId = randomUUID();

  beforeAll(async () => {
    await pool.query("insert into tenant (id, name) values ($1, 'PgPayfastItnLogStore test tenant')", [tenantId]);
  });

  afterAll(async () => {
    await runWithTenantContext(pool, tenantId, (client) => client.query("delete from tenant where id = $1", [tenantId]));
    await pool.end();
  });

  test("save persists a real row with a genuine jsonb round-trip of the raw payload", async () => {
    await store.save({
      id: randomUUID(),
      tenantId,
      mPaymentId: `${tenantId}:order-1`,
      pfPaymentId: "1089250",
      paymentStatus: "COMPLETE",
      amountGross: "100.00",
      signatureValid: true,
      serverConfirmed: true,
      rawPayload: { merchant_id: "10000100", item_name: "Test Item", custom_str1: "hello" },
      receivedAt: new Date(),
    });

    const entries = await store.findByTenant(tenantId);
    expect(entries).toHaveLength(1);
    expect(entries[0].pfPaymentId).toBe("1089250");
    expect(entries[0].rawPayload).toEqual({ merchant_id: "10000100", item_name: "Test Item", custom_str1: "hello" });
  });

  test("findByTenant is tenant-scoped, enforced by RLS", async () => {
    const otherTenantId = randomUUID();
    await pool.query("insert into tenant (id, name) values ($1, 'other tenant')", [otherTenantId]);
    await store.save({
      id: randomUUID(),
      tenantId: otherTenantId,
      mPaymentId: `${otherTenantId}:order-1`,
      pfPaymentId: "other-payment",
      paymentStatus: "COMPLETE",
      signatureValid: true,
      serverConfirmed: true,
      rawPayload: {},
      receivedAt: new Date(),
    });

    const entries = await store.findByTenant(tenantId);
    expect(entries.every((e) => e.pfPaymentId !== "other-payment")).toBe(true);

    await runWithTenantContext(pool, otherTenantId, (client) => client.query("delete from tenant where id = $1", [otherTenantId]));
  });
});

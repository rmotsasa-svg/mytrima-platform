import { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { PgSubscriptionStore, PgSubscriptionPaymentStore } from "./pg-billing.store";
import { runWithTenantContext } from "../../common/postgres";

/**
 * REAL integration test against a live PostgreSQL instance — gated behind
 * TEST_DATABASE_URL, same pattern as every other pg store test here.
 * Exercises the real `tenant_subscription`/`subscription_payment` tables
 * (0027_tenant_billing.sql) including their RLS policies.
 */
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const maybeDescribe = TEST_DATABASE_URL ? describe : describe.skip;

maybeDescribe("PgSubscriptionStore + PgSubscriptionPaymentStore against a real PostgreSQL instance", () => {
  const pool = new Pool({ connectionString: TEST_DATABASE_URL });
  const subscriptions = new PgSubscriptionStore(pool);
  const payments = new PgSubscriptionPaymentStore(pool);
  const tenantId = randomUUID();

  beforeAll(async () => {
    await pool.query("insert into tenant (id, name) values ($1, 'PgBillingStore test tenant')", [tenantId]);
  });

  afterAll(async () => {
    await runWithTenantContext(pool, tenantId, (client) => client.query("delete from tenant where id = $1", [tenantId]));
    await pool.end();
  });

  test("find returns null for a tenant with no subscription row, then save + find round-trip a real one", async () => {
    expect(await subscriptions.find(tenantId)).toBeNull();

    const now = new Date();
    const periodEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    await subscriptions.save({ tenantId, package: "Growth Plan", status: "active", currentPeriodStart: now, currentPeriodEnd: periodEnd, updatedAt: now });

    const found = await subscriptions.find(tenantId);
    expect(found?.package).toBe("Growth Plan");
    expect(found?.status).toBe("active");
    expect(found?.currentPeriodEnd?.getTime()).toBeCloseTo(periodEnd.getTime(), -2);
  });

  test("save() upserts — a second save for the same tenant replaces the row rather than duplicating it", async () => {
    const now = new Date();
    await subscriptions.save({ tenantId, package: "Pro Plus", status: "active", updatedAt: now });
    await subscriptions.save({ tenantId, package: "Growth Partner", status: "active", updatedAt: now });
    expect((await subscriptions.find(tenantId))?.package).toBe("Growth Partner");
  });

  test("payments: save + findById + listForTenant round-trip real rows, and save() again updates status in place", async () => {
    const paymentId = randomUUID();
    await payments.save({
      id: paymentId,
      tenantId,
      package: "Pro Plus",
      amount: 350,
      mopaySessionId: "MOP_real_test",
      mopayReference: "realtestref",
      status: "created",
      createdAt: new Date(),
    });

    const found = await payments.findById(tenantId, paymentId);
    expect(found).toMatchObject({ package: "Pro Plus", amount: 350, status: "created" });

    const completedAt = new Date();
    await payments.save({ ...found!, status: "completed", completedAt });
    const updated = await payments.findById(tenantId, paymentId);
    expect(updated?.status).toBe("completed");
    expect(updated?.completedAt).toBeInstanceOf(Date);

    const bySession = await payments.findByMoPaySessionId(tenantId, "MOP_real_test");
    expect(bySession?.id).toBe(paymentId);

    const list = await payments.listForTenant(tenantId);
    expect(list.some((p) => p.id === paymentId)).toBe(true);
  });
});

import { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { SocialConnectionService } from "./social-connection.service";
import { PgSocialConnectionStore } from "./pg-social-connection.store";
import { runWithTenantContext } from "../../common/postgres";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const maybeDescribe = TEST_DATABASE_URL ? describe : describe.skip;

maybeDescribe("PgSocialConnectionStore + SocialConnectionService against a real PostgreSQL instance", () => {
  const pool = new Pool({ connectionString: TEST_DATABASE_URL });
  const service = new SocialConnectionService(new PgSocialConnectionStore(pool));
  const tenantId = randomUUID();

  beforeAll(async () => {
    await pool.query("insert into tenant (id, name) values ($1, 'PgSocialConnectionStore test tenant')", [tenantId]);
  });

  afterAll(async () => {
    await runWithTenantContext(pool, tenantId, (client) => client.query("delete from tenant where id = $1", [tenantId]));
    await pool.end();
  });

  test("save persists a real connection row, retrievable by getForTenant", async () => {
    await service.save({
      id: randomUUID(),
      tenantId,
      provider: "facebook",
      pageId: "123456789",
      pageName: "Real Test Page",
      pageAccessToken: "real-page-token",
      connectedAt: new Date(),
    });

    const connection = await service.getForTenant(tenantId);
    expect(connection?.pageName).toBe("Real Test Page");
    expect(connection?.pageAccessToken).toBe("real-page-token");
  });

  test("save again for the same tenant replaces the connection (one per tenant per provider)", async () => {
    await service.save({
      id: randomUUID(),
      tenantId,
      provider: "facebook",
      pageId: "999999999",
      pageName: "Reconnected Page",
      pageAccessToken: "new-real-page-token",
      connectedAt: new Date(),
    });

    const connection = await service.getForTenant(tenantId);
    expect(connection?.pageId).toBe("999999999");
    expect(connection?.pageName).toBe("Reconnected Page");
  });

  test("getForTenant is tenant-scoped, enforced by RLS", async () => {
    const otherTenantId = randomUUID();
    await pool.query("insert into tenant (id, name) values ($1, 'other tenant')", [otherTenantId]);
    await service.save({
      id: randomUUID(),
      tenantId: otherTenantId,
      provider: "facebook",
      pageId: "111111111",
      pageName: "Other tenant's Page",
      pageAccessToken: "other-token",
      connectedAt: new Date(),
    });

    const connection = await service.getForTenant(tenantId);
    expect(connection?.pageName).not.toBe("Other tenant's Page");

    await runWithTenantContext(pool, otherTenantId, (client) => client.query("delete from tenant where id = $1", [otherTenantId]));
  });
});

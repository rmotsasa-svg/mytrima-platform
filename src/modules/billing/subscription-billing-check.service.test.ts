import { SubscriptionBillingCheckService } from "./subscription-billing-check.service";
import { SubscriptionService } from "./subscription.service";
import { InMemorySubscriptionPaymentStore } from "./in-memory-subscription-payment.store";
import { TenantService } from "../auth/tenant.service";
import { InMemoryTenantStore } from "../auth/in-memory-tenant.store";
import { AuthService } from "../auth/auth.service";
import { InMemoryAuthUserStore } from "../auth/in-memory-auth-user.store";
import { InMemoryRevokedRefreshTokenStore } from "../auth/in-memory-revoked-token.store";
import { generateMfaEncryptionKey } from "../auth/mfa-secret-crypto";
import { ConsoleEmailService } from "../integrations/email/email.service";

function makeService(mopayApiKey = "") {
  const tenantService = new TenantService(
    new InMemoryTenantStore(),
    new AuthService(new InMemoryAuthUserStore(), "test-secret", new InMemoryRevokedRefreshTokenStore(), generateMfaEncryptionKey()),
    new ConsoleEmailService()
  );
  const subscriptionService = new SubscriptionService(new InMemorySubscriptionPaymentStore(), tenantService, mopayApiKey);
  const service = new SubscriptionBillingCheckService(null, subscriptionService, tenantService, new ConsoleEmailService());
  return { service, tenantService };
}

test("checkAllTenants returns 0/0 and does nothing when there is no pool (DATABASE_URL unset)", async () => {
  const { service } = makeService();
  await expect(service.checkAllTenants()).resolves.toEqual({ confirmed: 0, renewalsCharged: 0 });
});

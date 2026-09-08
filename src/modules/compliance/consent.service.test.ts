import { ConsentService, ConsentNotFoundError } from "./consent.service";
import { InMemoryConsentStore } from "./in-memory-consent.store";

test("grant then assertHasConsent succeeds", async () => {
  const service = new ConsentService(new InMemoryConsentStore());
  await service.grant("t1", "c1", "whatsapp_marketing", "consent", "r1");
  const record = await service.assertHasConsent("t1", "c1", "whatsapp_marketing");
  expect(record.lawfulBasis).toBe("consent");
});

test("assertHasConsent throws for a category never granted", async () => {
  const service = new ConsentService(new InMemoryConsentStore());
  await expect(service.assertHasConsent("t1", "c1", "whatsapp_marketing")).rejects.toThrow(ConsentNotFoundError);
});

test("revoked consent no longer satisfies assertHasConsent", async () => {
  const service = new ConsentService(new InMemoryConsentStore());
  await service.grant("t1", "c1", "survey_response", "consent", "r2");
  await service.revoke("t1", "r2");
  await expect(service.assertHasConsent("t1", "c1", "survey_response")).rejects.toThrow(ConsentNotFoundError);
});

test("consent is tenant-scoped: another tenant's grant does not satisfy the check", async () => {
  const service = new ConsentService(new InMemoryConsentStore());
  await service.grant("tenant-A", "c1", "survey_response", "consent", "r3");
  await expect(service.assertHasConsent("tenant-B", "c1", "survey_response")).rejects.toThrow(ConsentNotFoundError);
});

/**
 * Regression test for a real gap surfaced while building the Postgres-
 * backed ConsentStore: revoke() originally took only an id, with no tenant
 * to scope a real RLS-enforced query to — a caller from the wrong tenant
 * (by accident or otherwise) must not be able to revoke another tenant's
 * consent record.
 */
test("revoke does nothing when called with the wrong tenantId — cannot revoke another tenant's consent record", async () => {
  const service = new ConsentService(new InMemoryConsentStore());
  await service.grant("tenant-A", "c1", "survey_response", "consent", "r-cross-tenant");
  await service.revoke("tenant-B", "r-cross-tenant");
  const record = await service.assertHasConsent("tenant-A", "c1", "survey_response");
  expect(record.revokedAt).toBeUndefined();
});

test("exportForDsar returns every record for a customer, including revoked ones", async () => {
  const service = new ConsentService(new InMemoryConsentStore());
  await service.grant("t1", "c1", "survey_response", "consent", "r4");
  await service.grant("t1", "c1", "whatsapp_marketing", "consent", "r5");
  await service.revoke("t1", "r5");
  const all = await service.exportForDsar("t1", "c1");
  expect(all.length).toBe(2);
});

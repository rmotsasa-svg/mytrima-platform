import { Test } from "@nestjs/testing";
import { AppModule } from "./app.module";
import { AppController } from "./app.controller";
import { GrowthAuditController } from "./modules/growth-audit/growth-audit.controller";
import { GrowthAuditService } from "./modules/growth-audit/growth-audit.service";
import { NpsController } from "./modules/growth-audit/nps.controller";
import { NpsService } from "./modules/growth-audit/nps.service";
import { ConsentController } from "./modules/compliance/consent.controller";
import { ConsentService } from "./modules/compliance/consent.service";
import { RatingController } from "./modules/reputation/rating.controller";
import { RatingService } from "./modules/reputation/rating.service";
import { AuthController } from "./modules/auth/auth.controller";
import { AuthService } from "./modules/auth/auth.service";
import { CustomerController } from "./modules/customers/customer.controller";
import { CustomerService } from "./modules/customers/customer.service";
import { AccessTokenGuard, AuthenticatedRequest } from "./modules/auth/access-token.guard";
import { totp, base32Decode } from "./modules/auth/totp";
import { MfaEnrollmentRequiredError } from "./modules/auth/auth.service";
import { InsufficientPermissionError } from "./modules/auth/rbac";
import { DEMO_TENANT_ID } from "./common/demo-tenant";
import { NotificationDeliveryService } from "./modules/automation/notification-delivery.service";
import { NotificationWorkerService } from "./modules/automation/notification-worker.service";
import { RevokedTokenCleanupService } from "./modules/auth/revoked-token-cleanup.service";
import { TenantService } from "./modules/auth/tenant.service";
import { CatalogController } from "./modules/catalog/catalog.controller";
import { CatalogService } from "./modules/catalog/catalog-item.service";
import { DealsController } from "./modules/deals/deals.controller";
import { DealService } from "./modules/deals/deal.service";
import { VendorController, PettyCashController } from "./modules/petty-cash/petty-cash.controller";
import { VendorService } from "./modules/petty-cash/vendor.service";
import { PettyCashService } from "./modules/petty-cash/petty-cash.service";
import { SalesController } from "./modules/sales/sales.controller";
import { SaleService } from "./modules/sales/sale.service";
import { SalesTargetService } from "./modules/sales/sales-target.service";
import { KpiBenchmarkService } from "./modules/sales/kpi-benchmark.service";
import { KpiBenchmarkCheckService } from "./modules/sales/kpi-benchmark-check.service";
import { ExecutionContext } from "@nestjs/common";

function fakeGuardContext(bearerToken: string): { context: ExecutionContext; request: Partial<AuthenticatedRequest> } {
  const request: Partial<AuthenticatedRequest> = { headers: { authorization: `Bearer ${bearerToken}` } };
  const context = {
    switchToHttp: () => ({ getRequest: () => request, getResponse: () => ({}), getNext: () => undefined }),
  } as unknown as ExecutionContext;
  return { context, request };
}

/**
 * This is the one test in the suite that proves the NestJS application
 * shell itself is wired correctly — every other test exercises a module's
 * business logic directly (new Service(store)), which says nothing about
 * whether the DI tokens, module imports, and provider bindings in
 * app.module.ts / each *.module.ts actually resolve. Booting the real
 * Nest DI container here and asking it for each controller/service is what
 * would catch a missing provider, an unbound @Inject() token, or a module
 * left out of AppModule's imports.
 */
test("AppModule compiles and resolves every controller and service via the real Nest DI container", async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

  expect(moduleRef.get(AppController)).toBeInstanceOf(AppController);
  expect(moduleRef.get(GrowthAuditController)).toBeInstanceOf(GrowthAuditController);
  expect(moduleRef.get(GrowthAuditService)).toBeInstanceOf(GrowthAuditService);
  expect(moduleRef.get(NpsController)).toBeInstanceOf(NpsController);
  expect(moduleRef.get(NpsService)).toBeInstanceOf(NpsService);
  expect(moduleRef.get(ConsentController)).toBeInstanceOf(ConsentController);
  expect(moduleRef.get(ConsentService)).toBeInstanceOf(ConsentService);
  expect(moduleRef.get(RatingController)).toBeInstanceOf(RatingController);
  expect(moduleRef.get(RatingService)).toBeInstanceOf(RatingService);
  expect(moduleRef.get(AuthController)).toBeInstanceOf(AuthController);
  expect(moduleRef.get(AuthService)).toBeInstanceOf(AuthService);
  expect(moduleRef.get(CustomerController)).toBeInstanceOf(CustomerController);
  expect(moduleRef.get(CustomerService)).toBeInstanceOf(CustomerService);
  expect(moduleRef.get(AccessTokenGuard)).toBeInstanceOf(AccessTokenGuard);
  expect(moduleRef.get(NotificationDeliveryService)).toBeInstanceOf(NotificationDeliveryService);
  expect(moduleRef.get(NotificationWorkerService)).toBeInstanceOf(NotificationWorkerService);
  expect(moduleRef.get(RevokedTokenCleanupService)).toBeInstanceOf(RevokedTokenCleanupService);
  expect(moduleRef.get(TenantService)).toBeInstanceOf(TenantService);
  expect(moduleRef.get(CatalogController)).toBeInstanceOf(CatalogController);
  expect(moduleRef.get(CatalogService)).toBeInstanceOf(CatalogService);
  expect(moduleRef.get(DealsController)).toBeInstanceOf(DealsController);
  expect(moduleRef.get(DealService)).toBeInstanceOf(DealService);
  expect(moduleRef.get(VendorController)).toBeInstanceOf(VendorController);
  expect(moduleRef.get(PettyCashController)).toBeInstanceOf(PettyCashController);
  expect(moduleRef.get(VendorService)).toBeInstanceOf(VendorService);
  expect(moduleRef.get(PettyCashService)).toBeInstanceOf(PettyCashService);
  expect(moduleRef.get(SalesController)).toBeInstanceOf(SalesController);
  expect(moduleRef.get(SaleService)).toBeInstanceOf(SaleService);
  expect(moduleRef.get(SalesTargetService)).toBeInstanceOf(SalesTargetService);
  expect(moduleRef.get(KpiBenchmarkService)).toBeInstanceOf(KpiBenchmarkService);
  expect(moduleRef.get(KpiBenchmarkCheckService)).toBeInstanceOf(KpiBenchmarkCheckService);

  await moduleRef.close();
});

/**
 * Proves the actual security fix, end to end, through the real DI-resolved
 * AccessTokenGuard + AuthController + AuthService + store — not a
 * from-scratch AuthService like access-token.guard.test.ts uses to unit-test
 * the guard in isolation. Two real accounts, two real tokens, run through
 * the same guard the HTTP layer actually uses:
 *   - Caller A starts and confirms their own MFA enrollment — the legitimate
 *     path still works end to end.
 *   - Caller B, authenticated as themselves via their own real token, cannot
 *     complete "A's" enrollment: B never started one, so B has no secret to
 *     verify a code against, no matter what code is presented. Before
 *     AccessTokenGuard existed, a caller could simply put A's ids in the
 *     request body regardless of whose token they held — that path no
 *     longer exists; identity now comes only from the verified token.
 */
test("MFA enrollment is bound to the caller's own verified access token, not a body-supplied identity", async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const authService = moduleRef.get(AuthService);
  const authController = moduleRef.get(AuthController);
  const guard = moduleRef.get(AccessTokenGuard);

  const suffix = Date.now();
  const userA = await authService.register(DEMO_TENANT_ID, `mfa-guard-a-${suffix}@example.com`, "password123", "staff", `mfa-a-${suffix}`);
  const userB = await authService.register(DEMO_TENANT_ID, `mfa-guard-b-${suffix}@example.com`, "password123", "staff", `mfa-b-${suffix}`);
  const tokensA = await authService.login(DEMO_TENANT_ID, userA.email, "password123");
  const tokensB = await authService.login(DEMO_TENANT_ID, userB.email, "password123");

  const reqA = fakeGuardContext(tokensA.accessToken);
  const reqB = fakeGuardContext(tokensB.accessToken);
  guard.canActivate(reqA.context);
  guard.canActivate(reqB.context);
  const verifiedA = reqA.request.user!;
  const verifiedB = reqB.request.user!;
  expect(verifiedA.userId).not.toBe(verifiedB.userId);

  const enrollment = await authController.startMfaEnrollment(verifiedA);
  const validCodeForA = totp(base32Decode(enrollment.secret));

  // B, authenticated as themselves, cannot ride A's code — B never started
  // an enrollment, so B has no secret at all to check it against.
  await expect(authController.confirmMfaEnrollment(verifiedB, { code: validCodeForA })).rejects.toThrow(MfaEnrollmentRequiredError);

  // The legitimate path — A confirming their own enrollment — still works.
  await authController.confirmMfaEnrollment(verifiedA, { code: validCodeForA });

  await moduleRef.close();
});

/**
 * Proves the actual fix for the registration gap, end to end, through the
 * real DI-resolved AccessTokenGuard + AuthController + AuthService +
 * rbac.ts's authorize() — the first real caller authorize() has anywhere in
 * this codebase (previously unit-tested only, in rbac.test.ts, never wired
 * into a route). Two real accounts, two real logins, run through the same
 * guard the HTTP layer actually uses:
 *   - A 'staff' caller cannot register a new account at all — rejected with
 *     InsufficientPermissionError before AuthService.register() ever runs.
 *   - An 'owner' caller can — and the new account lands in the owner's own
 *     tenant (taken from their verified token), never a body-supplied one,
 *     and can immediately log in for real.
 * Before this fix, neither check existed: the request body's own tenantId
 * and role were trusted outright, so anyone could self-register as 'owner'
 * for any tenant with no authentication at all.
 */
test("registering a new account requires an authenticated owner, not a body-supplied identity", async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const authService = moduleRef.get(AuthService);
  const authController = moduleRef.get(AuthController);
  const guard = moduleRef.get(AccessTokenGuard);
  const suffix = Date.now();

  // Bootstrap an owner directly via the service — exactly how a real
  // tenant's first account would be seeded today (see auth.module.ts's
  // DEMO_TENANT_ID seed), since /auth/register itself now requires one to
  // already exist. Owner login enforces MFA, so enroll for real too.
  const owner = await authService.register(DEMO_TENANT_ID, `register-owner-${suffix}@example.com`, "password123", "owner", `owner-${suffix}`);
  const enrollment = await authService.startMfaEnrollment(DEMO_TENANT_ID, owner.id);
  const ownerCode = totp(base32Decode(enrollment.secret));
  await authService.confirmMfaEnrollment(DEMO_TENANT_ID, owner.id, ownerCode);
  const ownerTokens = await authService.login(DEMO_TENANT_ID, owner.email, "password123", totp(base32Decode(enrollment.secret)));

  const staff = await authService.register(DEMO_TENANT_ID, `register-staff-${suffix}@example.com`, "password123", "staff", `staff-${suffix}`);
  const staffTokens = await authService.login(DEMO_TENANT_ID, staff.email, "password123");

  const ownerReq = fakeGuardContext(ownerTokens.accessToken);
  const staffReq = fakeGuardContext(staffTokens.accessToken);
  guard.canActivate(ownerReq.context);
  guard.canActivate(staffReq.context);
  const verifiedOwner = ownerReq.request.user!;
  const verifiedStaff = staffReq.request.user!;

  // The staff caller cannot register anyone — lacks 'user:manage'. register()
  // isn't declared async, so authorize() throws synchronously, before ever
  // producing a promise to reject — the assertion has to match that (a
  // plain `expect(promise).rejects...` would never even see this throw).
  expect(() =>
    authController.register(verifiedStaff, { email: `should-fail-${suffix}@example.com`, password: "password123", role: "staff" })
  ).toThrow(InsufficientPermissionError);

  // The owner caller can, and the new account is genuinely usable.
  const invitedEmail = `invited-${suffix}@example.com`;
  const invited = await authController.register(verifiedOwner, { email: invitedEmail, password: "password123", role: "staff" });
  expect(invited.tenantId).toBe(DEMO_TENANT_ID);
  const invitedLogin = await authService.login(DEMO_TENANT_ID, invitedEmail, "password123");
  expect(invitedLogin.accessToken).toBeTruthy();

  await moduleRef.close();
});

/**
 * AuthModule seeds a demo account via an async useFactory (see
 * auth.module.ts) so the dashboard's login form has something real to
 * authenticate against. This proves that factory actually works end to end
 * through the real DI container — e.g. a forgotten `await` on hashPassword()
 * inside it would make every login silently fail, and no other test in this
 * suite would catch that.
 */
test("AuthModule's seeded demo account can actually log in through the real DI container", async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const authService = moduleRef.get(AuthService);

  const tokens = await authService.login(DEMO_TENANT_ID, "demo@mytrima.com", "demo1234");
  const verified = authService.verifyAccessToken(tokens.accessToken);
  expect(verified.tenantId).toBe(DEMO_TENANT_ID);
  expect(verified.role).toBe("staff");

  await moduleRef.close();
});

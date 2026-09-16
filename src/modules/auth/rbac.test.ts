import { authorize, hasPermission, CrossTenantAccessError, InsufficientPermissionError } from "./rbac";

test("owner has every defined permission", () => {
  const permissions = [
    "growth_audit:submit",
    "growth_audit:view",
    "rating:view",
    "rating:moderate",
    "consent:manage",
    "user:manage",
    "tenant:manage_settings",
  ] as const;
  for (const p of permissions) expect(hasPermission("owner", p)).toBe(true);
});

test("read_only lacks every write/administrative permission", () => {
  expect(hasPermission("read_only", "growth_audit:submit")).toBe(false);
  expect(hasPermission("read_only", "rating:moderate")).toBe(false);
  expect(hasPermission("read_only", "consent:manage")).toBe(false);
  expect(hasPermission("read_only", "user:manage")).toBe(false);
});

test("staff can moderate ratings and manage consent, but not manage users or tenant settings", () => {
  expect(hasPermission("staff", "rating:moderate")).toBe(true);
  expect(hasPermission("staff", "consent:manage")).toBe(true);
  expect(hasPermission("staff", "user:manage")).toBe(false);
  expect(hasPermission("staff", "tenant:manage_settings")).toBe(false);
});

test("authorize succeeds silently for staff acting within their own tenant with a permission they hold", () => {
  expect(() => authorize({ userId: "u1", tenantId: "t1", role: "staff" }, "t1", "rating:moderate")).not.toThrow();
});

test("authorize throws InsufficientPermissionError for read_only attempting a write within their own tenant", () => {
  expect(() => authorize({ userId: "u1", tenantId: "t1", role: "read_only" }, "t1", "rating:moderate")).toThrow(
    InsufficientPermissionError
  );
});

test("authorize throws CrossTenantAccessError for an owner acting on a different tenant's resource — no role escapes tenant scoping", () => {
  expect(() => authorize({ userId: "u1", tenantId: "tenant-A", role: "owner" }, "tenant-B", "tenant:manage_settings")).toThrow(
    CrossTenantAccessError
  );
});

// Added 2026-09-11 alongside wiring real guards onto the 13 previously-open
// controllers — see this file's own Permission type comment.
test("read_only can view sales/catalog/customers/booking/onboarding/reports but cannot manage any of them", () => {
  for (const view of ["sales:view", "catalog:view", "customers:view", "booking:view", "onboarding:view", "reports:view"] as const) {
    expect(hasPermission("read_only", view)).toBe(true);
  }
  for (const manage of ["sales:manage", "catalog:manage", "customers:manage", "booking:manage", "deals:manage", "petty_cash:manage", "refund:manage"] as const) {
    expect(hasPermission("read_only", manage)).toBe(false);
  }
});

test("staff and owner both have every new sales/catalog/customers/deals/booking permission", () => {
  const permissions = [
    "sales:view",
    "sales:manage",
    "catalog:view",
    "catalog:manage",
    "customers:view",
    "customers:manage",
    "deals:manage",
    "booking:view",
    "booking:manage",
    "onboarding:view",
    "reports:view",
  ] as const;
  for (const p of permissions) {
    expect(hasPermission("owner", p)).toBe(true);
    expect(hasPermission("staff", p)).toBe(true);
  }
});

// Added 2026-09-14 at the tenant's own explicit request: "manager must
// authorize petty cash and exchange." A real behavior change, not just a
// relabeling — plain staff genuinely lost both permissions.
test("manager and owner can manage petty cash and refunds; plain staff cannot", () => {
  for (const p of ["petty_cash:manage", "refund:manage"] as const) {
    expect(hasPermission("owner", p)).toBe(true);
    expect(hasPermission("manager", p)).toBe(true);
    expect(hasPermission("staff", p)).toBe(false);
    expect(hasPermission("read_only", p)).toBe(false);
  }
});

test("manager has every other real staff permission too, not just the two new ones", () => {
  for (const p of ["sales:manage", "catalog:manage", "customers:manage", "deals:manage", "booking:manage", "rating:moderate", "consent:manage"] as const) {
    expect(hasPermission("manager", p)).toBe(true);
  }
  // ...but not owner-only administrative permissions.
  expect(hasPermission("manager", "user:manage")).toBe(false);
  expect(hasPermission("manager", "tenant:manage_settings")).toBe(false);
});

// P3.1 of "ACTION PROPOSED ADDITIONS IN PRIORITY ORDER" — closing the real
// gap the 360 assessment found: SupportTicketController had no authorize()
// call at all. Same :view/:manage split already proven for
// sales/catalog/customers/booking above.
test("read_only can view support tickets but cannot file or reopen one", () => {
  expect(hasPermission("read_only", "support:view")).toBe(true);
  expect(hasPermission("read_only", "support:manage")).toBe(false);
});

test("owner, manager, and staff can all file/reopen support tickets", () => {
  for (const role of ["owner", "manager", "staff"] as const) {
    expect(hasPermission(role, "support:view")).toBe(true);
    expect(hasPermission(role, "support:manage")).toBe(true);
  }
});

test("cross-tenant check happens before the permission check", () => {
  // A read_only actor (lacks user:manage) hitting a cross-tenant resource
  // must fail with CrossTenantAccessError, not InsufficientPermissionError —
  // resource-tenant mismatch is checked first regardless of what the actor
  // could or couldn't do within their own tenant.
  expect(() => authorize({ userId: "u1", tenantId: "tenant-A", role: "read_only" }, "tenant-B", "user:manage")).toThrow(
    CrossTenantAccessError
  );
});

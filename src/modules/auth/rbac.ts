/**
 * Role-based access control, per Master Plan Section 10: "Role-based access
 * control scoped per tenant (Owner, Staff, Read-only); no cross-tenant role
 * exists by design." Two separate checks, deliberately in this order:
 *   1. Tenant match — an actor from one tenant must never act on another
 *      tenant's resource, regardless of role. This is the property RLS
 *      (0001_tenant_and_rls.sql) enforces at the database layer; this module
 *      enforces the same rule at the application layer, as defense in depth.
 *   2. Permission — does this role, within its own tenant, have the
 *      requested permission at all.
 * Checking tenant match first means a cross-tenant attempt always fails the
 * same way regardless of role, rather than leaking role-shaped information
 * about a resource in another tenant.
 */

export type Role = "owner" | "staff" | "read_only";

export type Permission =
  | "growth_audit:submit"
  | "growth_audit:view"
  | "rating:view"
  | "rating:moderate"
  | "consent:manage"
  | "user:manage"
  | "tenant:manage_settings"
  // Added 2026-09-11 closing the real gap the Platform Readiness Assessment
  // flagged: 13 controllers had no auth guard at all, so these permissions
  // — despite existing in this file since the beginning — were never
  // actually checked against most of the app's own business data. Split
  // into :view/:manage where read_only meaningfully differs from
  // owner/staff (sales, catalog, customers, booking); combined into one
  // :manage where it doesn't (deals, petty_cash — operational data with no
  // established read_only use case yet, same reasoning as this file's own
  // "no cross-tenant role exists" top comment: don't invent a permission
  // split nothing has asked for).
  | "sales:view"
  | "sales:manage"
  | "catalog:view"
  | "catalog:manage"
  | "customers:view"
  | "customers:manage"
  | "deals:manage"
  | "petty_cash:manage"
  | "booking:view"
  | "booking:manage"
  | "onboarding:view"
  | "reports:view"
  | "social:manage";

const ROLE_PERMISSIONS: Readonly<Record<Role, ReadonlySet<Permission>>> = {
  owner: new Set<Permission>([
    "growth_audit:submit",
    "growth_audit:view",
    "rating:view",
    "rating:moderate",
    "consent:manage",
    "user:manage",
    "tenant:manage_settings",
    "sales:view",
    "sales:manage",
    "catalog:view",
    "catalog:manage",
    "customers:view",
    "customers:manage",
    "deals:manage",
    "petty_cash:manage",
    "booking:view",
    "booking:manage",
    "onboarding:view",
    "reports:view",
    "social:manage",
  ]),
  staff: new Set<Permission>([
    "growth_audit:submit",
    "growth_audit:view",
    "rating:view",
    "rating:moderate",
    "consent:manage",
    "sales:view",
    "sales:manage",
    "catalog:view",
    "catalog:manage",
    "customers:view",
    "customers:manage",
    "deals:manage",
    "petty_cash:manage",
    "booking:view",
    "booking:manage",
    "onboarding:view",
    "reports:view",
    "social:manage",
  ]),
  read_only: new Set<Permission>([
    "growth_audit:view",
    "rating:view",
    "sales:view",
    "catalog:view",
    "customers:view",
    "booking:view",
    "onboarding:view",
    "reports:view",
  ]),
};

export interface Actor {
  userId: string;
  tenantId: string;
  role: Role;
}

export class CrossTenantAccessError extends Error {
  constructor(actorTenantId: string, resourceTenantId: string) {
    super(`Actor from tenant ${actorTenantId} cannot act on tenant ${resourceTenantId}'s resource`);
    this.name = "CrossTenantAccessError";
  }
}

export class InsufficientPermissionError extends Error {
  constructor(role: Role, permission: Permission) {
    super(`Role '${role}' lacks permission '${permission}'`);
    this.name = "InsufficientPermissionError";
  }
}

export function hasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].has(permission);
}

/** Throws CrossTenantAccessError or InsufficientPermissionError; returns
 * (void) silently when the actor is authorized. */
export function authorize(actor: Actor, resourceTenantId: string, permission: Permission): void {
  if (actor.tenantId !== resourceTenantId) {
    throw new CrossTenantAccessError(actor.tenantId, resourceTenantId);
  }
  if (!hasPermission(actor.role, permission)) {
    throw new InsufficientPermissionError(actor.role, permission);
  }
}

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
  | "tenant:manage_settings";

const ROLE_PERMISSIONS: Readonly<Record<Role, ReadonlySet<Permission>>> = {
  owner: new Set<Permission>([
    "growth_audit:submit",
    "growth_audit:view",
    "rating:view",
    "rating:moderate",
    "consent:manage",
    "user:manage",
    "tenant:manage_settings",
  ]),
  staff: new Set<Permission>(["growth_audit:submit", "growth_audit:view", "rating:view", "rating:moderate", "consent:manage"]),
  read_only: new Set<Permission>(["growth_audit:view", "rating:view"]),
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

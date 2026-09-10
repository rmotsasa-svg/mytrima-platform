import { Injectable } from "@nestjs/common";
import { AuthUserStore, AuthUserRecord } from "./auth.service";

/**
 * KNOWN GAP: in-memory only — see pg-auth-user.store.ts for the real
 * Postgres-backed implementation, live-verified against a real database.
 * This class stays useful for the dashboard's demo login (no live database
 * dependency needed for that) and for fast in-memory unit tests.
 */
@Injectable()
export class InMemoryAuthUserStore implements AuthUserStore {
  private users = new Map<string, AuthUserRecord>();

  /** Not part of the AuthUserStore interface AuthService depends on — a
   * synchronous store-specific seam for populating test/dev-bootstrap data
   * (e.g. the demo account in auth.module.ts) without needing `await`.
   * Functionally identical to save() below; kept separate only so existing
   * synchronous callers don't need to become async. */
  seed(user: AuthUserRecord): void {
    this.users.set(user.id, user);
  }

  async save(user: AuthUserRecord): Promise<void> {
    this.users.set(user.id, user);
  }

  async findByEmail(tenantId: string, email: string): Promise<AuthUserRecord | null> {
    for (const u of this.users.values()) {
      if (u.tenantId === tenantId && u.email === email) return u;
    }
    return null;
  }

  async findById(tenantId: string, id: string): Promise<AuthUserRecord | null> {
    const user = this.users.get(id);
    return user && user.tenantId === tenantId ? user : null;
  }

  async findAllForTenant(tenantId: string): Promise<AuthUserRecord[]> {
    return [...this.users.values()].filter((u) => u.tenantId === tenantId);
  }
}

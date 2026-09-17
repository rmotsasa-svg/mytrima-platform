import { AdminUserRecord, AdminUserStore } from "./admin-auth.service";

export class InMemoryAdminUserStore implements AdminUserStore {
  private readonly users = new Map<string, AdminUserRecord>();

  async findByEmail(email: string): Promise<AdminUserRecord | null> {
    return [...this.users.values()].find((u) => u.email === email) ?? null;
  }

  async findById(id: string): Promise<AdminUserRecord | null> {
    return this.users.get(id) ?? null;
  }

  async findAll(): Promise<AdminUserRecord[]> {
    return [...this.users.values()].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  }

  async save(user: AdminUserRecord): Promise<void> {
    this.users.set(user.id, user);
  }
}

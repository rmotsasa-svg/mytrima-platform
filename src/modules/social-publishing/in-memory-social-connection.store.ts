import { SocialConnection, SocialConnectionStore } from "./social-connection.service";

export class InMemorySocialConnectionStore implements SocialConnectionStore {
  private readonly connections = new Map<string, SocialConnection>();

  private key(tenantId: string, provider: string): string {
    return `${tenantId}:${provider}`;
  }

  async save(connection: SocialConnection): Promise<void> {
    this.connections.set(this.key(connection.tenantId, connection.provider), connection);
  }

  async findByTenant(tenantId: string, provider: "facebook"): Promise<SocialConnection | null> {
    return this.connections.get(this.key(tenantId, provider)) ?? null;
  }
}

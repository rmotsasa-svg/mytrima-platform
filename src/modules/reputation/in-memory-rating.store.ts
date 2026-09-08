import { Injectable } from "@nestjs/common";
import { RatingStore, Rating, RatingStatus } from "./rating.service";

/**
 * KNOWN GAP: in-memory only, same caveat as InMemoryConsentStore — replace
 * with a Postgres-backed implementation against the `rating` table
 * (db/migrations/0002_rating.sql) once a live database exists.
 */
@Injectable()
export class InMemoryRatingStore implements RatingStore {
  private ratings = new Map<string, Rating>();

  async save(rating: Rating): Promise<void> {
    this.ratings.set(rating.id, rating);
  }

  async updateStatus(tenantId: string, id: string, status: RatingStatus, moderatedAt: Date): Promise<void> {
    const r = this.ratings.get(id);
    if (r && r.tenantId === tenantId) {
      r.status = status;
      r.moderatedAt = moderatedAt;
    }
  }

  async findAllForTenant(tenantId: string): Promise<Rating[]> {
    return [...this.ratings.values()].filter((r) => r.tenantId === tenantId);
  }

  async findById(tenantId: string, id: string): Promise<Rating | null> {
    const r = this.ratings.get(id);
    return r && r.tenantId === tenantId ? r : null;
  }
}

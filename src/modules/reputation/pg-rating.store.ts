import { Pool } from "pg";
import { RatingStore, Rating, RatingStatus } from "./rating.service";
import { runWithTenantContext } from "../../common/postgres";

interface RatingRow {
  id: string;
  tenant_id: string;
  customer_id: string;
  stars: number;
  comment: string | null;
  status: RatingStatus;
  submitted_at: Date;
  moderated_at: Date | null;
}

function rowToRating(row: RatingRow): Rating {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    customerId: row.customer_id,
    stars: row.stars,
    comment: row.comment ?? undefined,
    status: row.status,
    submittedAt: row.submitted_at,
    moderatedAt: row.moderated_at ?? undefined,
  };
}

/**
 * Real Postgres-backed RatingStore, against the `rating` table from
 * 0002_rating.sql. Same tenant-context-per-transaction pattern as
 * PgConsentStore — see src/common/postgres.ts.
 *
 * ACTUALLY RUN against a real local PostgreSQL 17 instance — see
 * pg-rating.store.test.ts (gated behind TEST_DATABASE_URL).
 */
export class PgRatingStore implements RatingStore {
  constructor(private readonly pool: Pool) {}

  async save(rating: Rating): Promise<void> {
    await runWithTenantContext(this.pool, rating.tenantId, (client) =>
      client.query(
        `insert into rating (id, tenant_id, customer_id, stars, comment, status, submitted_at, moderated_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8)
         on conflict (id) do update set
           stars        = excluded.stars,
           comment      = excluded.comment,
           status       = excluded.status,
           submitted_at = excluded.submitted_at,
           moderated_at = excluded.moderated_at`,
        [
          rating.id,
          rating.tenantId,
          rating.customerId,
          rating.stars,
          rating.comment ?? null,
          rating.status,
          rating.submittedAt,
          rating.moderatedAt ?? null,
        ]
      )
    );
  }

  async updateStatus(tenantId: string, id: string, status: RatingStatus, moderatedAt: Date): Promise<void> {
    // tenantId scopes app.current_tenant_id, so RLS alone makes this a
    // no-op for a rating belonging to a different tenant.
    await runWithTenantContext(this.pool, tenantId, (client) =>
      client.query(`update rating set status = $2, moderated_at = $3 where id = $1`, [id, status, moderatedAt])
    );
  }

  async findAllForTenant(tenantId: string): Promise<Rating[]> {
    const result = await runWithTenantContext(this.pool, tenantId, (client) =>
      client.query<RatingRow>(`select * from rating where tenant_id = $1 order by submitted_at asc`, [tenantId])
    );
    return result.rows.map(rowToRating);
  }

  async findById(tenantId: string, id: string): Promise<Rating | null> {
    const result = await runWithTenantContext(this.pool, tenantId, (client) =>
      client.query<RatingRow>(`select * from rating where id = $1`, [id])
    );
    return result.rows[0] ? rowToRating(result.rows[0]) : null;
  }
}

import { Pool } from "pg";
import { Booking, BookingStore, BookingStatus } from "./booking.service";
import { runWithTenantContext } from "../../common/postgres";

interface BookingRow {
  id: string;
  tenant_id: string;
  customer_id: string;
  catalog_item_id: string;
  scheduled_at: Date;
  duration_minutes: number;
  status: BookingStatus;
  notes: string | null;
  created_at: Date;
}

function rowToBooking(row: BookingRow): Booking {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    customerId: row.customer_id,
    catalogItemId: row.catalog_item_id,
    scheduledAt: row.scheduled_at,
    durationMinutes: row.duration_minutes,
    status: row.status,
    notes: row.notes ?? undefined,
    createdAt: row.created_at,
  };
}

/** Real Postgres-backed BookingStore, against `booking`
 * (db/migrations/0020_booking.sql). Same runWithTenantContext pattern as
 * every other real store here — see src/common/postgres.ts, and this
 * project's own RLS-tenant-context lesson (recommendation.service.ts's
 * markDetected() comment): the status-transition UPDATE below runs inside
 * runWithTenantContext just like the initial INSERT, or RLS would silently
 * match zero rows. */
export class PgBookingStore implements BookingStore {
  constructor(private readonly pool: Pool) {}

  async save(booking: Booking): Promise<void> {
    await runWithTenantContext(this.pool, booking.tenantId, (client) =>
      client.query(
        `insert into booking (id, tenant_id, customer_id, catalog_item_id, scheduled_at, duration_minutes, status, notes)
         values ($1, $2, $3, $4, $5, $6, $7, $8)
         on conflict (id) do update set status = excluded.status, notes = excluded.notes`,
        [
          booking.id,
          booking.tenantId,
          booking.customerId,
          booking.catalogItemId,
          booking.scheduledAt,
          booking.durationMinutes,
          booking.status,
          booking.notes ?? null,
        ]
      )
    );
  }

  async findAllForTenant(tenantId: string, periodStart?: Date, periodEnd?: Date): Promise<Booking[]> {
    return runWithTenantContext(this.pool, tenantId, async (client) => {
      const conditions = ["tenant_id = $1"];
      const params: unknown[] = [tenantId];
      if (periodStart) {
        params.push(periodStart);
        conditions.push(`scheduled_at >= $${params.length}`);
      }
      if (periodEnd) {
        params.push(periodEnd);
        conditions.push(`scheduled_at <= $${params.length}`);
      }
      const result = await client.query<BookingRow>(
        `select * from booking where ${conditions.join(" and ")} order by scheduled_at asc`,
        params
      );
      return result.rows.map(rowToBooking);
    });
  }

  async findById(tenantId: string, id: string): Promise<Booking | null> {
    const result = await runWithTenantContext(this.pool, tenantId, (client) =>
      client.query<BookingRow>(`select * from booking where id = $1`, [id])
    );
    return result.rows[0] ? rowToBooking(result.rows[0]) : null;
  }
}

import { Inject, Injectable } from "@nestjs/common";
import { BOOKING_STORE } from "./booking.tokens";
import { CatalogService } from "../catalog/catalog-item.service";
import { CustomerService, CustomerNotFoundError } from "../customers/customer.service";

/**
 * A tenant's customers booking a `service` catalog item for a specific
 * time — the feature requested directly by the tenant on 2026-09-10.
 * Deliberately minimal, same "no invented capabilities" discipline as
 * every other module here: one shared schedule per tenant (no per-staff
 * calendar — nothing in this schema tracks which staff member serves a
 * customer, the same simplification Sales already makes), no recurring
 * bookings, no timezone handling beyond storing a real UTC instant. Those
 * are real, disclosed scope limits, not oversights — see README.md.
 *
 * `requestBooking()` is the one endpoint an actual customer calls, and a
 * customer is not a Mytrima account holder anywhere in this system (no
 * customer-auth concept exists) — so, same as RatingController.submit()
 * and NpsController.submit(), it is deliberately public/unauthenticated at
 * the HTTP layer. It still requires a real, already-created Customer
 * record (via CustomerService) rather than accepting loose contact
 * fields — this reuses the existing CustomerModule instead of inventing a
 * second, parallel "who is this" mechanism, at the cost of requiring the
 * tenant (or a future public sign-up step this module does not build) to
 * create the Customer record first.
 */

export type BookingStatus = "requested" | "confirmed" | "completed" | "cancelled" | "no_show";

export interface Booking {
  id: string;
  tenantId: string;
  customerId: string;
  catalogItemId: string;
  scheduledAt: Date;
  durationMinutes: number;
  status: BookingStatus;
  notes?: string;
  createdAt: Date;
}

export interface RequestBookingInput {
  customerId: string;
  catalogItemId: string;
  scheduledAt: Date;
  /** Optional — falls back to the catalog item's own `durationMinutes` if
   * it has one set. See this file's own comment on why there's no further
   * fallback beyond that (no guessed default like 60 minutes). */
  durationMinutes?: number;
  notes?: string;
}

export class InvalidBookingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidBookingError";
  }
}

export class BookingNotFoundError extends Error {
  constructor(id: string) {
    super(`No booking found with id "${id}"`);
    this.name = "BookingNotFoundError";
  }
}

/** Thrown when a requested slot overlaps an existing `requested` or
 * `confirmed` booking for the same tenant — see this file's own top
 * comment on why this is a single shared schedule, not per-staff. Carries
 * the conflicting booking's id/time so a caller can show a real,
 * actionable message instead of a generic "conflict". */
export class BookingConflictError extends Error {
  constructor(public readonly conflictingBookingId: string, public readonly conflictingScheduledAt: Date) {
    super(`Requested time conflicts with an existing booking (${conflictingBookingId}) at ${conflictingScheduledAt.toISOString()}`);
    this.name = "BookingConflictError";
  }
}

export class InvalidBookingStatusTransitionError extends Error {
  constructor(from: BookingStatus, to: BookingStatus) {
    super(`Cannot move a booking from "${from}" to "${to}"`);
    this.name = "InvalidBookingStatusTransitionError";
  }
}

export interface BookingStore {
  save(booking: Booking): Promise<void>;
  findAllForTenant(tenantId: string, periodStart?: Date, periodEnd?: Date): Promise<Booking[]>;
  findById(tenantId: string, id: string): Promise<Booking | null>;
}

function overlaps(aStart: Date, aDurationMinutes: number, bStart: Date, bDurationMinutes: number): boolean {
  const aEnd = aStart.getTime() + aDurationMinutes * 60_000;
  const bEnd = bStart.getTime() + bDurationMinutes * 60_000;
  return aStart.getTime() < bEnd && bStart.getTime() < aEnd;
}

// A booking already `requested` occupies the slot too — otherwise two
// customers could both "request" the same overlapping time and only find
// out one of them loses when staff tries to confirm the second.
const SLOT_HOLDING_STATUSES: ReadonlySet<BookingStatus> = new Set(["requested", "confirmed"]);

@Injectable()
export class BookingService {
  constructor(
    @Inject(BOOKING_STORE) private readonly store: BookingStore,
    private readonly catalogService: CatalogService,
    private readonly customerService: CustomerService
  ) {}

  async requestBooking(tenantId: string, id: string, input: RequestBookingInput): Promise<Booking> {
    const customer = await this.customerService.findById(tenantId, input.customerId);
    if (!customer) throw new CustomerNotFoundError(input.customerId);

    const catalogItem = await this.catalogService.findById(tenantId, input.catalogItemId);
    if (!catalogItem) throw new InvalidBookingError(`No catalog item found with id "${input.catalogItemId}"`);
    if (catalogItem.itemType !== "service") throw new InvalidBookingError(`Catalog item "${catalogItem.name}" is not a service — only services can be booked`);
    if (!catalogItem.isActive) throw new InvalidBookingError(`Catalog item "${catalogItem.name}" is not currently active`);

    const durationMinutes = input.durationMinutes ?? catalogItem.durationMinutes;
    if (durationMinutes === undefined) {
      throw new InvalidBookingError(
        `"${catalogItem.name}" has no default duration set and none was given — set one via PATCH /catalog/:tenantId/:itemId or pass durationMinutes on the booking`
      );
    }
    if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) {
      throw new InvalidBookingError("durationMinutes must be a positive number");
    }

    if (input.scheduledAt.getTime() < Date.now()) {
      throw new InvalidBookingError("scheduledAt must be in the future");
    }

    const existing = await this.store.findAllForTenant(tenantId);
    const conflict = existing.find(
      (b) => SLOT_HOLDING_STATUSES.has(b.status) && overlaps(input.scheduledAt, durationMinutes, b.scheduledAt, b.durationMinutes)
    );
    if (conflict) throw new BookingConflictError(conflict.id, conflict.scheduledAt);

    const booking: Booking = {
      id,
      tenantId,
      customerId: input.customerId,
      catalogItemId: input.catalogItemId,
      scheduledAt: input.scheduledAt,
      durationMinutes,
      status: "requested",
      notes: input.notes?.trim() || undefined,
      createdAt: new Date(),
    };
    await this.store.save(booking);
    return booking;
  }

  async listForTenant(tenantId: string, periodStart?: Date, periodEnd?: Date): Promise<Booking[]> {
    return this.store.findAllForTenant(tenantId, periodStart, periodEnd);
  }

  async findById(tenantId: string, id: string): Promise<Booking | null> {
    return this.store.findById(tenantId, id);
  }

  private async transition(tenantId: string, id: string, allowedFrom: BookingStatus[], to: BookingStatus): Promise<Booking> {
    const existing = await this.store.findById(tenantId, id);
    if (!existing) throw new BookingNotFoundError(id);
    if (!allowedFrom.includes(existing.status)) throw new InvalidBookingStatusTransitionError(existing.status, to);
    const updated: Booking = { ...existing, status: to };
    await this.store.save(updated);
    return updated;
  }

  /** Staff accepts a customer's request — the point a real confirmation
   * notification should go out (see automation.service.ts's
   * notificationsForNewBookingRequest, wired at the CONTROLLER's request
   * step instead, since that is the event tenant staff actually need to
   * act on; confirming is staff's own action, not something staff need to
   * be told about). */
  async confirm(tenantId: string, id: string): Promise<Booking> {
    return this.transition(tenantId, id, ["requested"], "confirmed");
  }

  /** Either side can cancel before the appointment happens — a requested
   * booking staff never got to, or a confirmed one a customer can't make
   * after all. Once completed/cancelled/no_show, cancelling again is a
   * real state error, not a silent no-op. */
  async cancel(tenantId: string, id: string): Promise<Booking> {
    return this.transition(tenantId, id, ["requested", "confirmed"], "cancelled");
  }

  /** Only a confirmed booking can be marked complete — staff must have
   * actually accepted it first; there's no path from "requested" straight
   * to "completed". */
  async complete(tenantId: string, id: string): Promise<Booking> {
    return this.transition(tenantId, id, ["confirmed"], "completed");
  }

  async markNoShow(tenantId: string, id: string): Promise<Booking> {
    return this.transition(tenantId, id, ["confirmed"], "no_show");
  }
}

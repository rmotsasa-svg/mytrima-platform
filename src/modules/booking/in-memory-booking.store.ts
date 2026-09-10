import { Booking, BookingStore } from "./booking.service";

export class InMemoryBookingStore implements BookingStore {
  private readonly bookings = new Map<string, Booking>();

  async save(booking: Booking): Promise<void> {
    this.bookings.set(booking.id, booking);
  }

  async findAllForTenant(tenantId: string, periodStart?: Date, periodEnd?: Date): Promise<Booking[]> {
    return [...this.bookings.values()]
      .filter((b) => b.tenantId === tenantId)
      .filter((b) => (periodStart ? b.scheduledAt >= periodStart : true))
      .filter((b) => (periodEnd ? b.scheduledAt <= periodEnd : true))
      .sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime());
  }

  async findById(tenantId: string, id: string): Promise<Booking | null> {
    const booking = this.bookings.get(id);
    return booking && booking.tenantId === tenantId ? booking : null;
  }
}

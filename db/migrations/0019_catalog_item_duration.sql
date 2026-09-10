-- Mytrima — Migration 0019: catalog_item.duration_minutes
-- Backs the new Booking module (0020): a `service` item's default
-- appointment length. Nullable — a product has no duration, and even a
-- service can be created without one (a booking must then be given an
-- explicit duration; see booking.service.ts's own comment on why this
-- isn't defaulted to a guessed number).

begin;

alter table catalog_item
  add column duration_minutes integer check (duration_minutes > 0);

commit;

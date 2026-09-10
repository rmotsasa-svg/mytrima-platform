-- Mytrima — Migration 0020: Booking module
-- Lets a tenant's customers book a `service` catalog item for a specific
-- time. Deliberately minimal, matching this project's "no invented
-- capabilities" discipline: one time slot per booking, no staff/resource
-- calendar (a tenant is treated as one shared schedule, same simplification
-- Sales/Growth Audit already make — no location dimension either), no
-- recurring bookings. `scheduled_at` + `duration_minutes` together define
-- the slot; overlap is checked in the application layer
-- (BookingService.requestBooking), not a DB exclusion constraint, since
-- pg's `tstzrange` + `EXCLUDE USING gist` would need the `btree_gist`
-- extension enabled — a real infra step not yet confirmed available on the
-- pilot's actual Postgres instance, so the simpler, portable app-layer
-- check is used for this first cut and disclosed as such.

begin;

create table booking (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references tenant(id) on delete cascade,
  customer_id       uuid not null references customer(id) on delete cascade,
  catalog_item_id   uuid not null references catalog_item(id) on delete restrict,
  scheduled_at      timestamptz not null,
  duration_minutes  integer not null check (duration_minutes > 0),
  status            text not null check (status in ('requested', 'confirmed', 'completed', 'cancelled', 'no_show')),
  notes             text,
  created_at        timestamptz not null default now()
);

create index booking_tenant_scheduled_at_idx on booking (tenant_id, scheduled_at);

alter table booking enable row level security;

create policy tenant_isolation_booking on booking
  using (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  with check (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

commit;

-- Mytrima — Migration 0044: quotation customer address
-- Real gap closed 2026-09-16 at the tenant's own explicit request
-- ("quotation must have... customer address"). Free text, same
-- discipline as quotation.notes — a real address a tenant types once per
-- quotation, not auto-copied from customer.location (that column's own
-- comment already documents it as "a town/area name, not a structured
-- address").

begin;

alter table quotation add column customer_address text;

commit;

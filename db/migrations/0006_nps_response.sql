-- Mytrima — Migration 0006: NPS response persistence
-- Per Technical Master Plan, Section 5 (Survey & NPS Engine — "built in-house,
-- sharing its response/scoring data model with the Growth Audit engine") and
-- Section 9/10 ("detractors need a fast, tracked follow-up path, not just a
-- stored score"). Closes a KNOWN GAP flagged inline in nps.controller.ts since
-- this scaffold's NPS logic was first written: categorize()/needsFollowUp() on
-- a single submitted score were always real, but nothing persisted a response,
-- so computeNps() (the tenant-wide %promoter − %detractor aggregate) had
-- nothing to aggregate over via HTTP.
--
-- customer_id is a real foreign key, same as rating.customer_id (0002) —
-- an NPS response needs a real customer to attach to, created via
-- POST /customers first (see src/modules/customers/).

begin;

create table nps_response (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenant(id) on delete cascade,
  customer_id   uuid not null references customer(id) on delete cascade,
  score         smallint not null check (score between 0 and 10),
  comment       text,
  submitted_at  timestamptz not null default now()
);

alter table nps_response enable row level security;

create policy tenant_isolation_nps_response on nps_response
  using (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  with check (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

commit;

-- ---------------------------------------------------------------------------
-- Same known gap as 0002_rating.sql's own trailing note: this table is not yet
-- added to db/tests/rls_negative.sql's automated negative test — both tables
-- share that same still-open item, not something newly introduced here.
-- ---------------------------------------------------------------------------

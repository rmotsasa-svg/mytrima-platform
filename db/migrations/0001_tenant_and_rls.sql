-- Mytrima — Migration 0001: Tenant model + Row-Level Security
-- Per Technical Master Plan, Section 5 (Multi-Tenancy Model) and Section 7 (Data Model).
-- Approach: shared database, shared schema, tenant_id on every tenant-scoped table,
-- enforced by PostgreSQL RLS at the database layer — not application code alone.
--
-- ACTUALLY RUN, for real, against a local PostgreSQL 17 instance — not just written
-- and assumed correct. That run caught a real bug this file shipped with: the
-- `citext` type was used on email columns below without ever creating the citext
-- extension, which fails immediately on a real database with
-- `ERROR: type "citext" does not exist`. Fixed by adding the extension below,
-- confirmed by re-running against the same real instance until every statement
-- in this file succeeded. A security advisor should still review this before
-- being treated as final (Master Plan Section 16) — "runs without erroring" is
-- not the same claim as "is a correct security design."

begin;

create extension if not exists "pgcrypto";  -- for gen_random_uuid()
create extension if not exists "citext";    -- for case-insensitive email columns below

-- ---------------------------------------------------------------------------
-- Tenant: the business account. Every tenant-scoped table references this.
-- ---------------------------------------------------------------------------
create table tenant (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  country       text not null default 'LS',            -- ISO 3166-1 alpha-2; LS = Lesotho
  status        text not null default 'pilot'           -- pilot | active | suspended
                  check (status in ('pilot', 'active', 'suspended')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- App user: staff of a tenant. Role drives RBAC (Master Plan Section 9).
-- ---------------------------------------------------------------------------
create table app_user (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenant(id) on delete cascade,
  email         citext not null,
  role          text not null check (role in ('owner', 'staff', 'read_only')),
  mfa_enabled   boolean not null default false,
  created_at    timestamptz not null default now(),
  unique (tenant_id, email)
);

-- ---------------------------------------------------------------------------
-- Customer: a tenant's end customer. Conversations, reviews, payments attach here.
-- ---------------------------------------------------------------------------
create table customer (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenant(id) on delete cascade,
  display_name  text,
  phone_e164    text,          -- for WhatsApp / mobile-money correlation once those integrations land
  email         citext,
  created_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- ConsentRecord: lawful basis per data category, per customer.
-- POPIA accountability requirement (Master Plan Section 10) — first-class,
-- not a single blanket flag.
-- ---------------------------------------------------------------------------
create table consent_record (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references tenant(id) on delete cascade,
  customer_id     uuid not null references customer(id) on delete cascade,
  data_category   text not null,   -- e.g. 'survey_response', 'whatsapp_marketing', 'review_publication'
  lawful_basis    text not null,   -- e.g. 'consent', 'contract', 'legitimate_interest' — set per legal review
  granted_at      timestamptz not null default now(),
  revoked_at      timestamptz
);

-- ---------------------------------------------------------------------------
-- GrowthAuditResponse: one per audit administration (see growth-audit module).
-- ---------------------------------------------------------------------------
create table growth_audit_response (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references tenant(id) on delete cascade,
  administered_by uuid references app_user(id),
  answers         jsonb not null,   -- { "1": 3, "2": 4, ... "40": 2 }
  section_scores  jsonb,            -- computed at submit time; see growth-audit.service.ts
  overall_score   numeric(5,2),
  band            text,             -- Critical | Weak | Stable | High-Growth
  created_at      timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- AuditLog: immutable access/change log. Required for POPIA accountability.
-- Application layer must INSERT-only; no UPDATE/DELETE grants for app roles.
-- ---------------------------------------------------------------------------
create table audit_log (
  id            bigserial primary key,
  tenant_id     uuid references tenant(id),   -- nullable: platform-level events have no tenant
  actor_user_id uuid references app_user(id),
  action        text not null,
  entity_table  text not null,
  entity_id     uuid,
  occurred_at   timestamptz not null default now(),
  metadata      jsonb
);

-- ---------------------------------------------------------------------------
-- Row-Level Security
-- ---------------------------------------------------------------------------
-- Pattern: every tenant-scoped table is locked down, and a policy compares
-- tenant_id against a session-local setting the application sets per request
-- (`set_config('app.current_tenant_id', $1, true)` inside each transaction).
-- A bug in application-layer WHERE-clause filtering cannot leak another
-- tenant's rows, because the database itself refuses the row.

alter table app_user             enable row level security;
alter table customer             enable row level security;
alter table consent_record       enable row level security;
alter table growth_audit_response enable row level security;

-- Per Master Plan v1.2 (Section 9 Resolution Playbook): every policy below now
-- carries a matching WITH CHECK clause, not just USING. USING alone governs
-- which existing rows are visible; without WITH CHECK, a session could still
-- INSERT/UPDATE a row claiming a different tenant_id than its own if the
-- application forgot to set it correctly. This closes that gap rather than
-- leaving it as a known-but-unfixed flag.

create policy tenant_isolation_app_user on app_user
  using (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  with check (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

create policy tenant_isolation_customer on customer
  using (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  with check (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

create policy tenant_isolation_consent_record on consent_record
  using (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  with check (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

create policy tenant_isolation_growth_audit_response on growth_audit_response
  using (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  with check (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- audit_log is intentionally NOT tenant-isolated for SELECT at the DB layer in
-- the same way — platform admins need cross-tenant visibility for incident
-- response. Application-layer RBAC must restrict tenant staff to their own
-- tenant's rows. This asymmetry should be reviewed explicitly by the security
-- advisor (Master Plan Section 16) — flagged here rather than left implicit.

commit;

-- ---------------------------------------------------------------------------
-- Per Master Plan v1.2: the negative test has moved from a manual procedure
-- to an automated script — see db/tests/rls_negative.sql. That script, and
-- this migration, have both now been ACTUALLY RUN against a real local
-- PostgreSQL 17 instance: all four tables above were created successfully,
-- and the negative test passed — Tenant A's session could not see or insert
-- into Tenant B's rows. Still NOT executed against a real GitHub Actions
-- runner via the Postgres service container in .github/workflows/ci.yml —
-- confirm that specific path goes green too, though the SQL itself is now
-- known-good independent of it. db/tests/rls_negative.test.md is kept for
-- the rationale behind the WITH CHECK gap it originally caught, now closed
-- above and confirmed closed by the live test run.
-- ---------------------------------------------------------------------------

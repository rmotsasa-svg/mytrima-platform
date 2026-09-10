-- Mytrima — Migration 0018: Growth Audit recommendation log
-- Backs the real recommendation engine (src/modules/growth-audit/
-- recommendation.service.ts) — the centerpiece of closing the Growth
-- Audit's diagnose-but-never-prescribe gap identified by deep review.
-- Records every real recommendation issued so a later re-fetch can detect
-- whether the tenant actually acted on it (action_detected_at), the KPI
-- that proves this loop is more than "we sent a message and hoped".

begin;

create table recommendation (
  id                       uuid primary key default gen_random_uuid(),
  tenant_id                uuid not null references tenant(id) on delete cascade,
  growth_audit_response_id uuid not null references growth_audit_response(id) on delete cascade,
  section_key              text not null,
  question_id              integer not null,
  action_key               text not null,
  action_label             text not null,
  created_at               timestamptz not null default now(),
  action_detected_at       timestamptz
);

alter table recommendation enable row level security;

create policy tenant_isolation_recommendation on recommendation
  using (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  with check (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

commit;

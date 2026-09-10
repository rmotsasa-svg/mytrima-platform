-- Mytrima — Migration 0021: Support tickets
-- A tenant's own way to report a problem with Mytrima itself — requested
-- directly by the tenant on 2026-09-10. Real gap this closes: before this,
-- nothing let a tenant log an issue anywhere in this system; the pilot's
-- only recourse was an out-of-band channel (email/WhatsApp to the operator
-- directly), which is real but leaves no queryable record either side can
-- track. `created_by_user_id` records WHICH of the tenant's own staff filed
-- it (a real accountability signal — see support-ticket.service.ts).

begin;

create table support_ticket (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references tenant(id) on delete cascade,
  created_by_user_id uuid not null references app_user(id) on delete cascade,
  subject            text not null,
  description        text not null,
  severity           text not null check (severity in ('low', 'normal', 'high', 'critical')),
  status             text not null check (status in ('open', 'in_progress', 'resolved')),
  resolution_notes   text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index support_ticket_tenant_status_idx on support_ticket (tenant_id, status);

alter table support_ticket enable row level security;

create policy tenant_isolation_support_ticket on support_ticket
  using (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  with check (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

commit;

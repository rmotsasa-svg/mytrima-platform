-- Mytrima — Migration 0012: Social connection (Meta)
-- Backs the real Facebook Page connect flow (src/modules/social-publishing/) —
-- built specifically so Meta App Review's own screencast requirement can be
-- satisfied honestly: it must show the login/posting flow "on your app
-- platform," not on Meta's own Graph API Explorer (see meta.service.ts's own
-- comment on this finding). Stores the Page access token obtained through a
-- real Facebook Login OAuth exchange, one connection per tenant.
--
-- Standard Access only for now (a tenant connecting their OWN Facebook Page)
-- — Advanced Access (this platform managing OTHER businesses' Pages on their
-- behalf) needs Meta App Review + Business Verification, neither done yet.

begin;

create table social_connection (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references tenant(id) on delete cascade,
  provider            text not null default 'facebook' check (provider in ('facebook')),
  page_id             text not null,
  page_name           text not null,
  -- A real Meta Page access token. Not encrypted at rest here — same
  -- documented, not-yet-closed gap as auth_user.mfa_secret's encryption
  -- requirement (Master Plan Section 10); flagged rather than silently
  -- accepted, revisit before any real tenant's own Page is connected.
  page_access_token   text not null,
  connected_at        timestamptz not null default now(),
  unique (tenant_id, provider)
);

alter table social_connection enable row level security;

create policy tenant_isolation_social_connection on social_connection
  using (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  with check (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

commit;

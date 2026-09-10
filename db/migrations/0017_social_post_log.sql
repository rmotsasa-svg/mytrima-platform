-- Mytrima — Migration 0017: Social post log
-- Real gap found while designing the Growth Audit recommendation engine
-- (src/modules/growth-audit/recommendation.service.ts): nothing anywhere
-- persists Mytrima's OWN record of "did this tenant post to Facebook/
-- Instagram recently" — MetaGraphSocialService calls the real Graph API
-- live but never logs post history locally, so Growth Audit Section F
-- ("Do you follow a content or posting schedule?") had no real in-app
-- signal to check against, self-report only. This closes that gap.

begin;

create table social_post_log (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references tenant(id) on delete cascade,
  provider   text not null check (provider in ('facebook', 'instagram')),
  post_id    text not null,
  posted_at  timestamptz not null default now()
);

alter table social_post_log enable row level security;

create policy tenant_isolation_social_post_log on social_post_log
  using (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  with check (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

commit;

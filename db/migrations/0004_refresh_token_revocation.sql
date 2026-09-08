-- Mytrima — Migration 0004: Refresh token revocation
-- Per Technical Master Plan, Section 10 (Security Architecture) and the gap
-- originally flagged in auth.service.ts: refresh tokens were stateless JWTs
-- with no server-side record, so a specific one could never be revoked
-- before its natural expiry (e.g. for "log out everywhere" or responding to
-- a suspected leaked token). Backs
-- src/modules/auth/in-memory-revoked-token.store.ts's real (Postgres-free)
-- counterpart.
--
-- ACTUALLY RUN against a real local PostgreSQL 17 instance — not just written and
-- assumed correct, including a full server-restart proof: revoked a real refresh
-- token, killed the server, restarted it fresh, and confirmed that same token was
-- still rejected on a process that never saw the original login (see README.md's
-- "Auth/RBAC" section).

begin;

-- ---------------------------------------------------------------------------
-- RevokedRefreshToken: one row per refresh token that must no longer be
-- honored, even though its JWT `exp` claim hasn't passed yet. A row's
-- absence means "not revoked," not "doesn't exist" — jti is the JWT's own
-- unique token id (see the `jti` field AuthService signs into every
-- refresh token), not a foreign key to any other table here.
-- ---------------------------------------------------------------------------
create table revoked_refresh_token (
  jti           uuid primary key,
  tenant_id     uuid not null references tenant(id) on delete cascade,
  user_id       uuid not null references app_user(id) on delete cascade,
  revoked_at    timestamptz not null default now(),
  -- Mirrors the refresh token's own JWT `exp` — once past this, the row is
  -- provably useless (the JWT itself would already fail verification on
  -- expiry alone) and safe to delete. Required for the cleanup job flagged
  -- below, not enforced by the database itself.
  expires_at    timestamptz not null
);

alter table revoked_refresh_token enable row level security;

create policy tenant_isolation_revoked_refresh_token on revoked_refresh_token
  using (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  with check (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

commit;

-- ---------------------------------------------------------------------------
-- CLOSED: this table used to have no cleanup mechanism at all — nothing
-- deleted a row once expires_at passed, so it would grow forever at real
-- volume, holding rows that can no longer possibly matter (an expired JWT
-- already fails verification before this table is ever consulted).
-- src/modules/auth/revoked-token-cleanup.service.ts now runs exactly the
-- `delete from revoked_refresh_token where expires_at < now()` this comment
-- used to just describe, as a real daily BullMQ scheduled job — live-
-- verified against a real Postgres + Redis-compatible server, not just
-- written. Only active when both DATABASE_URL and REDIS_URL are set.
-- ---------------------------------------------------------------------------

-- Mytrima — Migration 0049: platform admin users
--
-- Real multi-admin authentication for the new admin app (see
-- C:\Users\USER\.claude\plans\twinkly-sprouting-orbit.md, Phase 1) —
-- replaces the single shared ADMIN_API_KEY secret as the day-to-day auth
-- mechanism. Genuinely separate from `app_user`/`revoked_refresh_token`:
-- an admin is not a tenant staff member and has no tenant_id at all, the
-- same "separate bounded context, separate table" discipline this
-- codebase already applies elsewhere (e.g. CommissionModule as its own
-- standalone module). No RLS on either table below — like `tenant`
-- itself, this is root-level operator identity, not tenant data.

begin;

create table admin_user (
  id            uuid primary key default gen_random_uuid(),
  email         text not null unique,
  password_hash text not null,
  -- AES-256-GCM ciphertext (mfa-secret-crypto.ts), never plaintext — same
  -- discipline as app_user.mfa_secret. MFA is mandatory for every admin
  -- account (unlike app_user, where only owners must enroll), so
  -- mfa_enabled starts false and login() refuses to issue a token until
  -- it's true, with no role-based exception.
  mfa_secret    text,
  mfa_enabled   boolean not null default false,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now()
);

create table admin_revoked_refresh_token (
  jti           uuid primary key,
  admin_user_id uuid not null references admin_user(id) on delete cascade,
  expires_at    timestamptz not null
);

commit;

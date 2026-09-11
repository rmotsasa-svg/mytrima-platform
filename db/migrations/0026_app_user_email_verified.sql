-- Mytrima — Migration 0026: app_user.email_verified
--
-- Backs the newly-opened self-serve tenant signup (POST /auth/tenants no
-- longer requires TENANT_SIGNUP_CODE by default — see tenant.service.ts's
-- own updated top comment). Opening signup to any stranger with an email
-- address is a real change in who can reach this platform at all, so a
-- freshly self-registered owner can no longer log in until they've proven
-- they actually control the inbox they signed up with — see
-- auth.service.ts's login()/issueEmailVerificationToken()/verifyEmailAddress().
--
-- Defaults true, same reasoning as 0022_app_user_active.sql's is_active
-- column: every account created before this existed (under the old
-- code-gated flow, or invited by an already-authenticated owner) is
-- unaffected — this only actually blocks login for a NEW self-serve
-- signup, which explicitly sets it false at creation.

begin;

alter table app_user
  add column email_verified boolean not null default true;

commit;

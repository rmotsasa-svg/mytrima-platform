-- Mytrima — Migration 0003: MFA secret column for app_user
-- Per Technical Master Plan, Section 10 (Security Architecture):
-- "Multi-factor authentication required for Owner-level and any
-- administrative accounts." Backs src/modules/auth/auth.service.ts.
--
-- ACTUALLY RUN against a real local PostgreSQL 17 instance — not just written and
-- assumed correct. Live-verified end to end: real enrollment, real TOTP
-- confirmation, and a real login enforcing MFA all ran against this exact column
-- (see README.md's "Auth/RBAC" section).

begin;

alter table app_user add column mfa_secret text;

commit;

-- ---------------------------------------------------------------------------
-- UPDATE: the plain-text gap originally flagged here is now closed at the
-- application layer. src/modules/auth/mfa-secret-crypto.ts encrypts every
-- secret (AES-256-GCM) before AuthService ever calls store.save() — this
-- column holds ciphertext, not a readable TOTP secret, regardless of what
-- reads the column directly. What's still required, and is NOT solved by
-- application-layer encryption alone: the encryption key itself must live
-- in a real secrets manager, not the dev-only fallback
-- auth.module.ts currently uses (see that file's own flag on
-- MFA_ENCRYPTION_KEY) — encrypting a secret with a key anyone can read from
-- source control provides no real protection.
-- ---------------------------------------------------------------------------

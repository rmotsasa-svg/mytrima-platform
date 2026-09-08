-- Mytrima — Migration 0005: password_hash column for app_user
-- A real gap found while building the Postgres-backed AuthUserStore
-- (pg-auth-user.store.ts): AuthUserRecord has required a passwordHash field
-- since auth.service.ts was first written, but 0001_tenant_and_rls.sql never
-- actually added a column for it — a gap that only surfaced when trying to
-- wire real persistence, the same way 0001's missing citext extension only
-- surfaced when that migration was actually run (see that file's own note).
--
-- ACTUALLY RUN against a real local PostgreSQL 17 instance as part of
-- verifying pg-auth-user.store.ts.

begin;

alter table app_user add column password_hash text not null default '';

commit;

-- ---------------------------------------------------------------------------
-- KNOWN GAP: `default ''` exists only so this ALTER TABLE succeeds against a
-- table that might already have rows (none do in any real deployment yet,
-- but the migration should stay safe if it's ever run against one that
-- does). A real app_user row must never actually have an empty
-- password_hash — PgAuthUserStore.save() always provides a real scrypt hash.
-- Consider dropping the default (making the column NOT NULL with no
-- default) once it's certain no pre-existing rows depend on it.
-- ---------------------------------------------------------------------------

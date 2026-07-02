-- Better Auth `admin` plugin columns — ban semantics (hardening slice, #222).
-- PostgreSQL twin of migrations/023_admin_ban_semantics.sql — see that file
-- for the full rationale. Column names are quoted camelCase to match the
-- rest of the Better Auth "user" table (see lib/auth-schema.ts
-- AUTH_SCHEMA_PG_SQL) and lib/schema.pg.ts, which represents isAdmin/disabled
-- (and now banned/banExpires) as INTEGER flags rather than native BOOLEAN, to
-- match the existing DB shape exactly.
--
-- NOTE: this intentionally does NOT add session."impersonatedBy" — this
-- slice only adopts the plugin's ban semantics, not its impersonation
-- feature.

ALTER TABLE "user" ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'user';
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS banned INTEGER DEFAULT 0;
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "banReason" TEXT;
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "banExpires" INTEGER;

-- Backfill: every existing admin gets role='admin' so the plugin recognizes
-- them. Guarded on "isAdmin" actually existing — as of this migration the PG
-- migration set is known-incomplete (no PG twin of SQLite migration
-- 002_add_admin.sql has ever existed; tracked as the separate, larger
-- PG-parity fix). Skip the backfill rather than fail the whole migration on
-- a fresh/partial PG deploy that doesn't have "isAdmin" yet — it can be
-- re-run (this UPDATE, or a fuller backfill) once that column exists.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'user' AND column_name = 'isAdmin'
  ) THEN
    UPDATE "user" SET role = 'admin' WHERE "isAdmin" = 1;
  END IF;
END $$;

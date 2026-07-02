-- Better Auth `admin` plugin columns — ban semantics (hardening slice, #222).
--
-- These are additive columns on the EXISTING Better Auth `user` table. The
-- plugin's banUser/unbanUser endpoints and its session.create.before hook
-- (which rejects sign-in for banned users, auto-lifting an expired ban) need
-- them:
--   * user.role   — the plugin's admin gate (adminRoles: ["admin"]). Synced
--                   to "admin" wherever isAdmin=1. Distinct from this app's
--                   RBAC roles/userRoles tables.
--   * user.banned/banReason/banExpires — enforced natively by the plugin.
--                   Supersedes the legacy, never-enforced user.disabled flag.
--
-- Column names are camelCase to match the rest of the Better Auth tables and
-- the names the admin plugin's schema declares (role / banned / banReason /
-- banExpires).
--
-- NOTE: this intentionally does NOT add session.impersonatedBy — this slice
-- only adopts the plugin's ban semantics, not its impersonation feature.

ALTER TABLE user ADD COLUMN role TEXT DEFAULT 'user';
ALTER TABLE user ADD COLUMN banned INTEGER DEFAULT 0;
ALTER TABLE user ADD COLUMN banReason TEXT;
ALTER TABLE user ADD COLUMN banExpires INTEGER;

-- Backfill: every existing admin gets role='admin' so the plugin recognizes
-- them (the ban-gate hook and any future admin-only endpoint keys off role;
-- this app's own authorization still keys off isAdmin).
UPDATE user SET role = 'admin' WHERE isAdmin = 1;

-- NOTE: no `-- DOWN` section. `wrangler d1 migrations apply` runs the whole
-- file as raw SQL (it does not parse the UP/DOWN marker), so a DOWN block
-- containing DROP/ALTER statements would execute on D1 and immediately undo
-- this migration. DOWN sections are intentionally omitted from all migrations.

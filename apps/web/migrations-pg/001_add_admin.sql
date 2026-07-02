-- PG twin of migrations/002_add_admin.sql (never ported — sync #222/#224
-- PG-parity fix). Numbered 001 (not 011+) because migrations-pg/002
-- ("002_enhance_newsletter_subscribers.sql") ALTERs newsletter_subscribers
-- and must run AFTER the table exists; on a fresh Postgres deploy, migration
-- files apply in filename-sorted order, so this has to sort before "002".
--
-- Creates the base app tables that were always assumed to exist once "user"
-- had isAdmin/disabled, and adds those two columns to "user" (AUTH_SCHEMA_PG_SQL
-- deliberately omits them — see lib/auth-schema.ts).

ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "isAdmin" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS disabled INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS admin_logs (
  id SERIAL PRIMARY KEY,
  admin_id TEXT NOT NULL REFERENCES "user"(id),
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  details TEXT,
  created_at TEXT DEFAULT now()::text
);

CREATE TABLE IF NOT EXISTS plan_overrides (
  id SERIAL PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE REFERENCES "user"(id),
  plan TEXT NOT NULL DEFAULT 'pro',
  reason TEXT,
  granted_by TEXT NOT NULL REFERENCES "user"(id),
  expires_at TEXT,
  created_at TEXT DEFAULT now()::text
);

-- Base shape only — "002_enhance_newsletter_subscribers.sql" (already
-- existing) adds name/source/unsubscribed_at/tags/unsubscribe_token next.
CREATE TABLE IF NOT EXISTS newsletter_subscribers (
  id SERIAL PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  status TEXT DEFAULT 'active',
  created_at TEXT DEFAULT now()::text
);

CREATE TABLE IF NOT EXISTS blog_posts (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  content TEXT NOT NULL,
  status TEXT DEFAULT 'draft',
  author_id TEXT REFERENCES "user"(id),
  published_at TEXT,
  created_at TEXT DEFAULT now()::text,
  updated_at TEXT DEFAULT now()::text
);

CREATE INDEX IF NOT EXISTS idx_admin_logs_admin_id ON admin_logs(admin_id);
CREATE INDEX IF NOT EXISTS idx_admin_logs_created_at ON admin_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_plan_overrides_user_id ON plan_overrides(user_id);

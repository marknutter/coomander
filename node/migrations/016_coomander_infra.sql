-- Coomander agent infrastructure (Ops A, #151 — milestone 1 "says hello").
--
-- Pure infrastructure port from ~/Code/geology. No domain logic here; the ops
-- domain model (cadence, procurement, content states) lands in #152.
--
-- All tables are user_id-scoped with ON DELETE CASCADE so a deleted user takes
-- their Coomander data with them.
--
-- Applied to dev SQLite via `npm run db:migrate` (lib/migrate.ts) and to prod
-- Cloudflare D1 via `wrangler d1 migrations apply` (migrations_dir = "migrations").

-- ── User-table extensions ───────────────────────────────────────────────────
-- camelCase to match the existing user-table convention (emailVerified, isAdmin,
-- stripeCustomerId). The `user` table is bootstrapped by Better Auth and is not
-- managed by drizzle-kit; these two app columns are added by hand here.
ALTER TABLE user ADD COLUMN telegramChatId TEXT;
ALTER TABLE user ADD COLUMN coomanderEnabled INTEGER NOT NULL DEFAULT 0;

-- ── coomander_settings ──────────────────────────────────────────────────────
-- Per-user agent configuration. One row per ops-enabled user.
--   nag_frequency: tight (default) | moderate | light  (see coomander-direction.md § Nag frequency)
--   persona_mode:  light_companion (default) | full_companion | operational
--   ping_times_json: optional per-user cron-time overrides (V2 polish)
--   companion_consent_at: unix seconds — set when the user opts into full_companion (if/when it ships)
CREATE TABLE IF NOT EXISTS coomander_settings (
  user_id TEXT PRIMARY KEY,
  nag_frequency TEXT NOT NULL DEFAULT 'tight',
  persona_mode TEXT NOT NULL DEFAULT 'light_companion',
  ping_times_json TEXT,
  companion_consent_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (user_id) REFERENCES user(id) ON DELETE CASCADE
);

-- ── coomander_message_log ───────────────────────────────────────────────────
-- The long-term companion-memory substrate. RETENTION POLICY: NO TTL, NO
-- deletion sweep, EVER. Full-companion persona (later) depends on having an
-- indefinite log of the creator's conversational history. Captures BOTH
-- directions, the structured tool-call (when an inbound classifies into a domain
-- action), and the persona mode in effect at send time. If we ever must delete
-- (explicit user request / GDPR), that is a manual operator action — never code.
CREATE TABLE IF NOT EXISTS coomander_message_log (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  direction TEXT NOT NULL,                 -- 'inbound' | 'outbound'
  telegram_update_id INTEGER,              -- nullable; set for inbound updates
  text TEXT NOT NULL,
  tool_call_json TEXT,                     -- nullable; classifier output for inbound
  persona_mode TEXT NOT NULL DEFAULT 'light_companion',
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (user_id) REFERENCES user(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_coomander_message_log_user_created
  ON coomander_message_log(user_id, created_at);

-- ── coomander_usage ─────────────────────────────────────────────────────────
-- Per-user Anthropic token usage. Write-path is exercised once the persona
-- prompt + classifier land; the table exists now so the schema is stable.
CREATE TABLE IF NOT EXISTS coomander_usage (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  slot_or_inbound TEXT NOT NULL,           -- 'morning' | 'midday' | 'evening' | 'check' | 'inbound'
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  model TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (user_id) REFERENCES user(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_coomander_usage_user_id ON coomander_usage(user_id);

-- ── coomander_day_state ─────────────────────────────────────────────────────
-- Per-user, per-day ping bookkeeping. planPing decision logic (milestone 2+)
-- reads/stamps these so a slot is not re-fired on every cron tick.
CREATE TABLE IF NOT EXISTS coomander_day_state (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  date TEXT NOT NULL,                      -- YYYY-MM-DD in the user's local tz
  morning_ping_sent_at INTEGER,
  midday_ping_sent_at INTEGER,
  evening_recap_at INTEGER,
  day_quality TEXT,                        -- 'good' | 'bad' | NULL
  FOREIGN KEY (user_id) REFERENCES user(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS coomander_day_state_user_date_unique
  ON coomander_day_state(user_id, date);
CREATE INDEX IF NOT EXISTS idx_coomander_day_state_user_id ON coomander_day_state(user_id);

-- ── coomander_dedup ─────────────────────────────────────────────────────────
-- Inbound Telegram update_id de-duplication (at-least-once delivery). Write-path
-- lands with the inbound webhook in milestone 2; the table exists now.
CREATE TABLE IF NOT EXISTS coomander_dedup (
  telegram_update_id INTEGER PRIMARY KEY,
  user_id TEXT NOT NULL,
  processed_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (user_id) REFERENCES user(id) ON DELETE CASCADE
);

-- Backfill: 28 tables declared in lib/schema.pg.ts that had no PG migration
-- at all (sync #222/#224 PG-parity fix — see also 001_add_admin.sql for the
-- 4 tables that had to be numbered before "002" for ordering reasons).
--
-- Column types/constraints/indexes are copied 1:1 from lib/schema.pg.ts.
-- camelCase column names are double-quoted so Postgres preserves case
-- (unquoted identifiers are folded to lowercase); snake_case columns need
-- no quoting. FK-dependent tables are created after the tables they
-- reference (posts before post_analysis/post_insights; roles before
-- user_roles; webhooks before webhook_deliveries; cadence_pillars before
-- cadence_beats before content_states before drops/procurement_items).

-- ─── user-table extensions (PG twin of migrations/016_coomander_infra.sql's
-- "User-table extensions" block — never ported). Needed for the
-- coomander_link_codes flow (which sets user.telegramChatId) to work at all
-- on PG, same class of bug as the missing isAdmin/disabled columns fixed in
-- 001_add_admin.sql. ────────────────────────────────────────────────────────
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "telegramChatId" TEXT;
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "coomanderEnabled" INTEGER NOT NULL DEFAULT 0;

-- ─── jobs ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  payload TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  "maxAttempts" INTEGER NOT NULL DEFAULT 3,
  "lastError" TEXT,
  "scheduledAt" INTEGER NOT NULL DEFAULT extract(epoch from now())::integer,
  "startedAt" INTEGER,
  "completedAt" INTEGER,
  "createdAt" INTEGER NOT NULL DEFAULT extract(epoch from now())::integer
);
CREATE INDEX IF NOT EXISTS idx_jobs_status_scheduled ON jobs(status, "scheduledAt");
CREATE INDEX IF NOT EXISTS idx_jobs_type ON jobs(type);

-- ─── files ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS files (
  id TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  key TEXT NOT NULL UNIQUE,
  filename TEXT NOT NULL,
  "contentType" TEXT NOT NULL DEFAULT 'application/octet-stream',
  size INTEGER NOT NULL DEFAULT 0,
  "storageBackend" TEXT NOT NULL DEFAULT 'local',
  "createdAt" INTEGER NOT NULL DEFAULT extract(epoch from now())::integer
);
CREATE INDEX IF NOT EXISTS idx_files_userId ON files("userId");
CREATE INDEX IF NOT EXISTS idx_files_key ON files(key);

-- ─── notifications ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  type TEXT NOT NULL DEFAULT 'info',
  title TEXT NOT NULL,
  message TEXT NOT NULL DEFAULT '',
  read INTEGER NOT NULL DEFAULT 0,
  "createdAt" INTEGER NOT NULL DEFAULT extract(epoch from now())::integer
);
CREATE INDEX IF NOT EXISTS idx_notifications_userId ON notifications("userId");
CREATE INDEX IF NOT EXISTS idx_notifications_userId_read ON notifications("userId", read);

-- ─── webhooks / webhook_deliveries ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS webhooks (
  id TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  secret TEXT NOT NULL,
  events TEXT NOT NULL DEFAULT '[]',
  active INTEGER NOT NULL DEFAULT 1,
  "createdAt" INTEGER NOT NULL DEFAULT extract(epoch from now())::integer,
  "updatedAt" INTEGER NOT NULL DEFAULT extract(epoch from now())::integer
);
CREATE INDEX IF NOT EXISTS idx_webhooks_userId ON webhooks("userId");

CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id TEXT PRIMARY KEY,
  "webhookId" TEXT NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
  event TEXT NOT NULL,
  payload TEXT NOT NULL DEFAULT '{}',
  "responseStatus" INTEGER,
  "responseBody" TEXT,
  success INTEGER NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 0,
  "lastError" TEXT,
  "createdAt" INTEGER NOT NULL DEFAULT extract(epoch from now())::integer,
  "completedAt" INTEGER
);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_webhookId ON webhook_deliveries("webhookId");
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_createdAt ON webhook_deliveries("createdAt");

-- ─── roles / user_roles ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS roles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  permissions TEXT NOT NULL DEFAULT '[]',
  is_system INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT now()::text,
  updated_at TEXT DEFAULT now()::text
);

CREATE TABLE IF NOT EXISTS user_roles (
  id SERIAL PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  assigned_by TEXT REFERENCES "user"(id) ON DELETE SET NULL,
  created_at TEXT DEFAULT now()::text
);
CREATE INDEX IF NOT EXISTS idx_user_roles_user_id ON user_roles(user_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_role_id ON user_roles(role_id);
CREATE UNIQUE INDEX IF NOT EXISTS user_roles_user_id_role_id_unique ON user_roles(user_id, role_id);

-- ─── waitlist / invite_codes ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS waitlist (
  id SERIAL PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  referral_code TEXT NOT NULL UNIQUE,
  referred_by TEXT,
  referral_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'waiting',
  created_at TEXT DEFAULT now()::text,
  invited_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_waitlist_email ON waitlist(email);
CREATE INDEX IF NOT EXISTS idx_waitlist_status ON waitlist(status);
CREATE INDEX IF NOT EXISTS idx_waitlist_referral_code ON waitlist(referral_code);

CREATE TABLE IF NOT EXISTS invite_codes (
  id SERIAL PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  email TEXT,
  used_by TEXT REFERENCES "user"(id),
  created_by TEXT NOT NULL REFERENCES "user"(id),
  created_at TEXT DEFAULT now()::text,
  used_at TEXT,
  expires_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_invite_codes_code ON invite_codes(code);
CREATE INDEX IF NOT EXISTS idx_invite_codes_email ON invite_codes(email);

-- ─── platforms / posts / post_analysis / post_insights ─────────────────────
CREATE TABLE IF NOT EXISTS platforms (
  id SERIAL PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  account_id TEXT NOT NULL,
  username TEXT,
  access_token TEXT,
  refresh_token TEXT,
  token_expires_at TEXT,
  created_at TEXT DEFAULT now()::text,
  updated_at TEXT DEFAULT now()::text
);
CREATE UNIQUE INDEX IF NOT EXISTS platforms_user_platform_unique ON platforms(user_id, platform);
CREATE INDEX IF NOT EXISTS idx_platforms_user_id ON platforms(user_id);

CREATE TABLE IF NOT EXISTS posts (
  id SERIAL PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  platform_post_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  caption TEXT,
  media_type TEXT,
  media_url TEXT,
  thumbnail_url TEXT,
  permalink TEXT,
  published_at TEXT,
  created_at TEXT DEFAULT now()::text
);
CREATE UNIQUE INDEX IF NOT EXISTS posts_user_platform_post_unique ON posts(user_id, platform, platform_post_id);
CREATE INDEX IF NOT EXISTS idx_posts_user_id ON posts(user_id);
CREATE INDEX IF NOT EXISTS idx_posts_user_published ON posts(user_id, published_at);

CREATE TABLE IF NOT EXISTS post_analysis (
  id SERIAL PRIMARY KEY,
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  setting TEXT,
  lighting TEXT,
  face_visible BOOLEAN,
  text_overlay BOOLEAN,
  visual_style TEXT,
  caption_length INTEGER,
  hook_type TEXT,
  cta_present BOOLEAN,
  cta_type TEXT,
  caption_tone TEXT,
  emoji_count INTEGER,
  hashtag_count INTEGER,
  transcript TEXT,
  spoken_hook TEXT,
  key_frame_analysis TEXT,
  raw_analysis TEXT,
  analyzed_at TEXT DEFAULT now()::text
);
CREATE UNIQUE INDEX IF NOT EXISTS post_analysis_post_unique ON post_analysis(post_id);
CREATE INDEX IF NOT EXISTS idx_post_analysis_user_id ON post_analysis(user_id);

CREATE TABLE IF NOT EXISTS post_insights (
  id SERIAL PRIMARY KEY,
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  snapshot_date TEXT NOT NULL,
  impressions INTEGER,
  reach INTEGER,
  engagement INTEGER,
  saves INTEGER,
  likes INTEGER,
  comments INTEGER,
  shares INTEGER,
  score INTEGER,
  upvote_ratio REAL,
  created_at TEXT DEFAULT now()::text
);
CREATE UNIQUE INDEX IF NOT EXISTS post_insights_post_date_unique ON post_insights(post_id, snapshot_date);
CREATE INDEX IF NOT EXISTS idx_post_insights_user_id ON post_insights(user_id);

-- ─── account_snapshots / demographics / content_insights ───────────────────
CREATE TABLE IF NOT EXISTS account_snapshots (
  id SERIAL PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  snapshot_date TEXT NOT NULL,
  follower_count INTEGER,
  media_count INTEGER,
  reach INTEGER,
  impressions INTEGER,
  profile_views INTEGER,
  created_at TEXT DEFAULT now()::text
);
CREATE UNIQUE INDEX IF NOT EXISTS account_snapshots_user_platform_date_unique ON account_snapshots(user_id, platform, snapshot_date);
CREATE INDEX IF NOT EXISTS idx_account_snapshots_user_id ON account_snapshots(user_id);

CREATE TABLE IF NOT EXISTS demographics (
  id SERIAL PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  snapshot_date TEXT NOT NULL,
  metric TEXT NOT NULL,
  key TEXT NOT NULL,
  value REAL NOT NULL,
  created_at TEXT DEFAULT now()::text
);
CREATE UNIQUE INDEX IF NOT EXISTS demographics_unique ON demographics(user_id, platform, snapshot_date, metric, key);
CREATE INDEX IF NOT EXISTS idx_demographics_user_id ON demographics(user_id);

CREATE TABLE IF NOT EXISTS content_insights (
  id SERIAL PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  report_json TEXT NOT NULL,
  posts_analyzed INTEGER NOT NULL,
  created_at TEXT DEFAULT now()::text
);
CREATE INDEX IF NOT EXISTS idx_content_insights_user_id ON content_insights(user_id);

-- ─── Coomander ops-agent infra (#151) ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS coomander_settings (
  user_id TEXT PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
  nag_frequency TEXT NOT NULL DEFAULT 'tight',
  persona_mode TEXT NOT NULL DEFAULT 'light_companion',
  ping_times_json TEXT,
  timezone TEXT,
  companion_consent_at INTEGER,
  ops_seeded_at INTEGER,
  defaults_banner_dismissed_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT extract(epoch from now())::integer,
  updated_at INTEGER NOT NULL DEFAULT extract(epoch from now())::integer
);

CREATE TABLE IF NOT EXISTS coomander_link_codes (
  code TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL DEFAULT extract(epoch from now())::integer
);

-- RETENTION POLICY: NO TTL, NO deletion sweep, EVER — see lib/schema.pg.ts.
CREATE TABLE IF NOT EXISTS coomander_message_log (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  direction TEXT NOT NULL,
  telegram_update_id INTEGER,
  text TEXT NOT NULL,
  tool_call_json TEXT,
  persona_mode TEXT NOT NULL DEFAULT 'light_companion',
  created_at INTEGER NOT NULL DEFAULT extract(epoch from now())::integer
);
CREATE INDEX IF NOT EXISTS idx_coomander_message_log_user_created ON coomander_message_log(user_id, created_at);

CREATE TABLE IF NOT EXISTS coomander_usage (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  slot_or_inbound TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  model TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT extract(epoch from now())::integer
);
CREATE INDEX IF NOT EXISTS idx_coomander_usage_user_id ON coomander_usage(user_id);

CREATE TABLE IF NOT EXISTS coomander_day_state (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  morning_ping_sent_at INTEGER,
  midday_ping_sent_at INTEGER,
  evening_recap_at INTEGER,
  day_quality TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS coomander_day_state_user_date_unique ON coomander_day_state(user_id, date);
CREATE INDEX IF NOT EXISTS idx_coomander_day_state_user_id ON coomander_day_state(user_id);

CREATE TABLE IF NOT EXISTS coomander_dedup (
  telegram_update_id INTEGER PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  processed_at INTEGER NOT NULL DEFAULT extract(epoch from now())::integer
);

-- ─── Coomander ops domain model (#152) ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS cadence_pillars (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  display_order INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'custom',
  archived_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT extract(epoch from now())::integer,
  updated_at INTEGER NOT NULL DEFAULT extract(epoch from now())::integer
);
CREATE INDEX IF NOT EXISTS idx_cadence_pillars_user_id ON cadence_pillars(user_id);

CREATE TABLE IF NOT EXISTS cadence_beats (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  pillar_id TEXT NOT NULL REFERENCES cadence_pillars(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  cadence_kind TEXT NOT NULL,
  target_count INTEGER NOT NULL DEFAULT 1,
  buffer_goal_days INTEGER,
  window_start TEXT,
  window_end TEXT,
  priority TEXT NOT NULL DEFAULT 'med',
  platform_specific TEXT,
  subtype TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  source TEXT NOT NULL DEFAULT 'custom',
  archived_at INTEGER,
  notes TEXT,
  created_at INTEGER NOT NULL DEFAULT extract(epoch from now())::integer,
  updated_at INTEGER NOT NULL DEFAULT extract(epoch from now())::integer
);
CREATE INDEX IF NOT EXISTS idx_cadence_beats_user_id ON cadence_beats(user_id);
CREATE INDEX IF NOT EXISTS idx_cadence_beats_pillar_id ON cadence_beats(pillar_id);

CREATE TABLE IF NOT EXISTS content_states (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  beat_id TEXT REFERENCES cadence_beats(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  current_state TEXT NOT NULL DEFAULT 'drafted',
  state_history_json TEXT NOT NULL DEFAULT '[]',
  drive_url TEXT,
  edited_url TEXT,
  notes TEXT,
  created_at INTEGER NOT NULL DEFAULT extract(epoch from now())::integer,
  updated_at INTEGER NOT NULL DEFAULT extract(epoch from now())::integer
);
CREATE INDEX IF NOT EXISTS idx_content_states_user_id ON content_states(user_id);
CREATE INDEX IF NOT EXISTS idx_content_states_user_state ON content_states(user_id, current_state);
CREATE INDEX IF NOT EXISTS idx_content_states_beat_id ON content_states(beat_id);

CREATE TABLE IF NOT EXISTS drops (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  beat_id TEXT NOT NULL REFERENCES cadence_beats(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  source TEXT NOT NULL,
  platform TEXT,
  external_ref TEXT,
  content_state_id TEXT REFERENCES content_states(id) ON DELETE SET NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  dropped_at INTEGER NOT NULL DEFAULT extract(epoch from now())::integer,
  created_at INTEGER NOT NULL DEFAULT extract(epoch from now())::integer
);
CREATE INDEX IF NOT EXISTS idx_drops_user_id ON drops(user_id);
CREATE INDEX IF NOT EXISTS idx_drops_user_beat_dropped ON drops(user_id, beat_id, dropped_at);

CREATE TABLE IF NOT EXISTS procurement_items (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  beat_id TEXT REFERENCES cadence_beats(id) ON DELETE SET NULL,
  category TEXT NOT NULL,
  label TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'needed',
  needed_by TEXT,
  estimated_cost_cents INTEGER,
  actual_cost_cents INTEGER,
  source TEXT NOT NULL DEFAULT 'custom',
  notes TEXT,
  created_at INTEGER NOT NULL DEFAULT extract(epoch from now())::integer,
  updated_at INTEGER NOT NULL DEFAULT extract(epoch from now())::integer
);
CREATE INDEX IF NOT EXISTS idx_procurement_user_id ON procurement_items(user_id);
CREATE INDEX IF NOT EXISTS idx_procurement_user_category ON procurement_items(user_id, category);

-- ─── Coomander weekly review (#154) ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS weekly_reviews (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  week_ending TEXT NOT NULL,
  review_json TEXT NOT NULL,
  telegram_message_id INTEGER,
  drift_question_message_ids_json TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL DEFAULT extract(epoch from now())::integer
);
CREATE UNIQUE INDEX IF NOT EXISTS weekly_reviews_user_week_unique ON weekly_reviews(user_id, week_ending);
CREATE INDEX IF NOT EXISTS idx_weekly_reviews_user_id ON weekly_reviews(user_id);

-- Coomander ops domain model (Ops B, #152).
--
-- OF-only creator-economy primitives Coomander operates against: cadence
-- pillars/beats, content lifecycle states, drops (acts of execution), and
-- procurement. Consistency metrics (streak, adherence, content-cushion-days)
-- are DERIVED from these in lib/coomander/consistency.ts, not stored.
--
-- Deliberately NO `projects` primitive (OF-only scope). All tables user_id-scoped
-- with ON DELETE CASCADE. Applies to dev SQLite (npm run db:migrate) and prod
-- D1 (wrangler d1 migrations apply).

-- ── cadence_pillars ─────────────────────────────────────────────────────────
-- High-level content/ops areas (Reels, OF Wall, Live, PPV, Procurement, Admin).
CREATE TABLE IF NOT EXISTS cadence_pillars (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('content', 'wall', 'procurement', 'engagement', 'admin')),
  display_order INTEGER NOT NULL DEFAULT 0,
  archived_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (user_id) REFERENCES user(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_cadence_pillars_user_id ON cadence_pillars(user_id);

-- ── cadence_beats ───────────────────────────────────────────────────────────
-- Recurring rhythms within a pillar. platform_specific is load-bearing for the
-- trials-are-IG-only case; subtype distinguishes trial vs normal reels;
-- cadence_kind = 'daily_vlog_buffer' models OF wall content as passive daily
-- vlogging with a buffer_goal_days target instead of a per-day nag.
CREATE TABLE IF NOT EXISTS cadence_beats (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  pillar_id TEXT NOT NULL,
  name TEXT NOT NULL,
  cadence_kind TEXT NOT NULL CHECK (cadence_kind IN ('daily', 'weekly', 'window', 'daily_vlog_buffer')),
  target_count INTEGER NOT NULL DEFAULT 1,
  buffer_goal_days INTEGER,
  window_start TEXT,
  window_end TEXT,
  priority TEXT NOT NULL DEFAULT 'med' CHECK (priority IN ('low', 'med', 'high')),
  platform_specific TEXT CHECK (platform_specific IN ('ig', 'tiktok', 'fb', 'snap', 'of')),
  subtype TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  archived_at INTEGER,
  notes TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (user_id) REFERENCES user(id) ON DELETE CASCADE,
  FOREIGN KEY (pillar_id) REFERENCES cadence_pillars(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_cadence_beats_user_id ON cadence_beats(user_id);
CREATE INDEX IF NOT EXISTS idx_cadence_beats_pillar_id ON cadence_beats(pillar_id);

-- ── content_states ──────────────────────────────────────────────────────────
-- Per-piece lifecycle state machine. current_state is constrained to the 7-step
-- enum; state_history_json records the audit trail of transitions.
CREATE TABLE IF NOT EXISTS content_states (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  beat_id TEXT,
  title TEXT NOT NULL,
  current_state TEXT NOT NULL DEFAULT 'drafted'
    CHECK (current_state IN ('drafted', 'shot', 'approved', 'uploaded_to_edit', 'edited', 'scheduled', 'shipped')),
  state_history_json TEXT NOT NULL DEFAULT '[]',
  drive_url TEXT,
  edited_url TEXT,
  notes TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (user_id) REFERENCES user(id) ON DELETE CASCADE,
  FOREIGN KEY (beat_id) REFERENCES cadence_beats(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_content_states_user_id ON content_states(user_id);
CREATE INDEX IF NOT EXISTS idx_content_states_user_state ON content_states(user_id, current_state);
CREATE INDEX IF NOT EXISTS idx_content_states_beat_id ON content_states(beat_id);

-- ── drops ───────────────────────────────────────────────────────────────────
-- Append-only acts of execution. kind = 'captured' is for daily-vlog wall buffer
-- (shot, not yet shipped). platform lets drops count against platform-specific
-- beats correctly.
CREATE TABLE IF NOT EXISTS drops (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  beat_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('shipped', 'purchased', 'completed', 'captured')),
  source TEXT NOT NULL CHECK (source IN ('auto_ig', 'auto_of', 'telegram', 'manual_ui')),
  platform TEXT CHECK (platform IN ('ig', 'tiktok', 'fb', 'snap', 'of')),
  external_ref TEXT,
  content_state_id TEXT,
  payload_json TEXT NOT NULL DEFAULT '{}',
  dropped_at INTEGER NOT NULL DEFAULT (unixepoch()),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (user_id) REFERENCES user(id) ON DELETE CASCADE,
  FOREIGN KEY (beat_id) REFERENCES cadence_beats(id) ON DELETE CASCADE,
  FOREIGN KEY (content_state_id) REFERENCES content_states(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_drops_user_id ON drops(user_id);
CREATE INDEX IF NOT EXISTS idx_drops_user_beat_dropped ON drops(user_id, beat_id, dropped_at);

-- ── procurement_items ───────────────────────────────────────────────────────
-- Things to acquire, split shoot_prep vs business_admin.
CREATE TABLE IF NOT EXISTS procurement_items (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  beat_id TEXT,
  category TEXT NOT NULL CHECK (category IN ('shoot_prep', 'business_admin')),
  label TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'needed' CHECK (status IN ('needed', 'ordered', 'received', 'canceled')),
  needed_by TEXT,
  estimated_cost_cents INTEGER,
  actual_cost_cents INTEGER,
  notes TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (user_id) REFERENCES user(id) ON DELETE CASCADE,
  FOREIGN KEY (beat_id) REFERENCES cadence_beats(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_procurement_user_id ON procurement_items(user_id);
CREATE INDEX IF NOT EXISTS idx_procurement_user_category ON procurement_items(user_id, category);

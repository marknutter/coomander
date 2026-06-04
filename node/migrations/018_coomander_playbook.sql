-- Coomander v1 playbook defaults (Ops C, #153).
--
-- Adds provenance to seeded rows (source = 'v1_default' vs 'custom') and the
-- per-user disclaimer-banner + seeded-state bookkeeping. SQLite ALTER TABLE
-- ADD COLUMN is safe/non-destructive; applied once per env.

-- Provenance on the seedable domain tables.
ALTER TABLE cadence_pillars ADD COLUMN source TEXT NOT NULL DEFAULT 'custom';
ALTER TABLE cadence_beats ADD COLUMN source TEXT NOT NULL DEFAULT 'custom';
ALTER TABLE procurement_items ADD COLUMN source TEXT NOT NULL DEFAULT 'custom';

-- Per-user ops bookkeeping on the settings row.
--   ops_seeded_at: set when seedOpsDefaults runs (idempotency guard).
--   defaults_banner_dismissed_at: set when the creator dismisses the disclaimer
--     banner or makes a first edit to a pillar/beat.
ALTER TABLE coomander_settings ADD COLUMN ops_seeded_at INTEGER;
ALTER TABLE coomander_settings ADD COLUMN defaults_banner_dismissed_at INTEGER;

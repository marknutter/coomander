-- Per-creator timezone for the local day boundary (#183, Phase 1).
--
-- "today", drop bucketing, the Day 1-6 ramp, and the weekly window are computed
-- in the creator's LOCAL calendar day instead of UTC, so a US creator's day no
-- longer rolls over at ~6-7pm local (UTC midnight). NULL falls back to
-- DEFAULT_TIMEZONE (env COOMANDER_TIMEZONE, default America/Chicago).
-- Ported from geology's agents.timezone (migration 017 there).

ALTER TABLE coomander_settings ADD COLUMN timezone TEXT;

-- In-app Telegram link flow (#185).
--
-- One-time codes to link a creator's Telegram chat to their account without DB
-- access. Settings/onboarding mints a code; the creator sends it (or taps a
-- t.me deep link -> /start <code>) to @coomander_bot; the webhook matches it,
-- sets user.telegramChatId, and deletes the code. Ported from geology's
-- channel_link_codes (migration 017 there).

CREATE TABLE IF NOT EXISTS coomander_link_codes (
  code       TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,              -- unix seconds; webhook ignores expired codes
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_coomander_link_codes_user_id ON coomander_link_codes(user_id);

-- Coomander weekly review (Ops D, #154).
--
-- Persists each generated Sunday weekly review. The full structured artifact
-- lives in review_json; the Telegram message ids let us thread drift-question
-- replies. user_id-scoped, ON DELETE CASCADE.

CREATE TABLE IF NOT EXISTS weekly_reviews (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  week_ending TEXT NOT NULL,                       -- ISO date (YYYY-MM-DD)
  review_json TEXT NOT NULL,
  telegram_message_id INTEGER,
  drift_question_message_ids_json TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (user_id) REFERENCES user(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS weekly_reviews_user_week_unique ON weekly_reviews(user_id, week_ending);
CREATE INDEX IF NOT EXISTS idx_weekly_reviews_user_id ON weekly_reviews(user_id);

-- Add marketing-related columns to newsletter_subscribers
ALTER TABLE newsletter_subscribers ADD COLUMN name TEXT;
ALTER TABLE newsletter_subscribers ADD COLUMN source TEXT DEFAULT 'website';
ALTER TABLE newsletter_subscribers ADD COLUMN unsubscribed_at TEXT;
ALTER TABLE newsletter_subscribers ADD COLUMN tags TEXT DEFAULT '[]';
ALTER TABLE newsletter_subscribers ADD COLUMN unsubscribe_token TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_ns_unsubscribe_token
  ON newsletter_subscribers(unsubscribe_token);

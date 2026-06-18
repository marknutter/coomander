CREATE TABLE IF NOT EXISTS email_events (
  id SERIAL PRIMARY KEY,
  email_id TEXT,
  campaign_id TEXT REFERENCES email_campaigns(id),
  subscriber_email TEXT,
  event_type TEXT NOT NULL,
  link_url TEXT,
  metadata TEXT DEFAULT '{}',
  created_at TEXT DEFAULT now()::text
);

CREATE INDEX IF NOT EXISTS idx_ee_campaign_id ON email_events(campaign_id);
CREATE INDEX IF NOT EXISTS idx_ee_subscriber_email ON email_events(subscriber_email);
CREATE INDEX IF NOT EXISTS idx_ee_event_type ON email_events(event_type);

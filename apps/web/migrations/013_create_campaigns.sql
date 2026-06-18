CREATE TABLE IF NOT EXISTS email_campaigns (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  subject TEXT NOT NULL,
  preview_text TEXT DEFAULT '',
  html_content TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  audience_filter TEXT DEFAULT '{}',
  recipient_count INTEGER DEFAULT 0,
  sent_count INTEGER DEFAULT 0,
  scheduled_at TEXT,
  sent_at TEXT,
  resend_broadcast_id TEXT,
  created_by TEXT NOT NULL REFERENCES user(id),
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_campaigns_status ON email_campaigns(status);
CREATE INDEX IF NOT EXISTS idx_campaigns_created_at ON email_campaigns(created_at);

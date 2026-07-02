-- Campaign send hardening (hardening follow-up to #454/#595, sync #222). PG
-- twin of migrations/026_campaign_send_hardening.sql.
ALTER TABLE email_campaigns ADD COLUMN IF NOT EXISTS batches_failed INTEGER DEFAULT 0;

CREATE UNIQUE INDEX IF NOT EXISTS idx_ee_failed_unique
  ON email_events (campaign_id, subscriber_email)
  WHERE event_type = 'failed';

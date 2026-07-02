-- Batched send engine progress counters (#454, epic #595, sync #222). PG twin
-- of migrations/024_campaign_send_batches.sql.
ALTER TABLE email_campaigns ADD COLUMN IF NOT EXISTS batches_total INTEGER DEFAULT 0;
ALTER TABLE email_campaigns ADD COLUMN IF NOT EXISTS batches_done INTEGER DEFAULT 0;

CREATE UNIQUE INDEX IF NOT EXISTS idx_email_events_sent_unique
  ON email_events(campaign_id, subscriber_email)
  WHERE event_type = 'sent';

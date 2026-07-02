-- Batched send engine progress counters (#454, epic #595, sync #222). The
-- send route now enqueues batches instead of blasting recipients inline; a
-- campaign finalizes to 'sent' once batches_done == batches_total.
ALTER TABLE email_campaigns ADD COLUMN batches_total INTEGER DEFAULT 0;
ALTER TABLE email_campaigns ADD COLUMN batches_done INTEGER DEFAULT 0;

-- Idempotent per-(campaign, recipient) sent-event dedup: a retried/redelivered
-- batch must never double-send. Partial unique index scoped to event_type='sent'
-- so other event types (opened/clicked/bounced) are unaffected.
CREATE UNIQUE INDEX IF NOT EXISTS idx_email_events_sent_unique
  ON email_events(campaign_id, subscriber_email)
  WHERE event_type = 'sent';

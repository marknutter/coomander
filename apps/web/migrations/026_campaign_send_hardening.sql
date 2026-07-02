-- Campaign send hardening (hardening follow-up to #454/#595, sync #222):
-- failed-batch accounting + dropped-recipient visibility.
--
-- 1. batches_failed: batches that permanently failed (retry-exhaustion /
--    dead-letter / stuck reconciliation). The campaign finalizes when
--    batches_done + batches_failed == batches_total — to 'sent' if none
--    failed, else 'failed'. This is what stops a campaign getting stuck in
--    'sending' forever when a batch is dropped.
ALTER TABLE email_campaigns ADD COLUMN batches_failed INTEGER DEFAULT 0;

-- 2. Dedup `failed` recipient events the same way migration 024 dedups `sent`,
--    so a recipient that keeps failing across batch retries records at most
--    one `failed` row (INSERT ... ON CONFLICT DO NOTHING). A later successful
--    resend writes a `sent` row and clears the stale `failed` row (see
--    lib/campaign-send.ts).
CREATE UNIQUE INDEX IF NOT EXISTS idx_ee_failed_unique
  ON email_events (campaign_id, subscriber_email)
  WHERE event_type = 'failed';

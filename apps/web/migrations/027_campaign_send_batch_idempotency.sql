-- Per-batch idempotency for the campaign send engine (correctness fix, sync
-- #222). advanceBatchProgress previously incremented email_campaigns
-- .batches_done unconditionally on every completed batch, INCLUDING a
-- Cloudflare Queues at-least-once REDELIVERY of an already-processed batch —
-- so batches_done could reach batches_total (finalizing the campaign as
-- 'sent') while a DIFFERENT batch's recipients were never emailed.
--
-- Each queued batch now carries a batch_id (its position within the current
-- send attempt). advanceBatchProgress records (campaign_id, batch_id) here
-- via INSERT ... ON CONFLICT DO NOTHING and only increments batches_done when
-- the row was actually inserted, so a redelivered batch is a no-op. Rows are
-- cleared per-campaign at the start of every fresh send/resend (see
-- lib/campaign-send.ts) so batch ids don't collide across attempts.
CREATE TABLE IF NOT EXISTS campaign_send_batches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id TEXT NOT NULL REFERENCES email_campaigns(id),
  batch_id TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_csb_campaign_batch_unique
  ON campaign_send_batches (campaign_id, batch_id);

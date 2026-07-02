-- PG twin of migrations/027_campaign_send_batch_idempotency.sql. See that
-- file for the full rationale.
CREATE TABLE IF NOT EXISTS campaign_send_batches (
  id SERIAL PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES email_campaigns(id),
  batch_id TEXT NOT NULL,
  created_at TEXT DEFAULT now()::text
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_csb_campaign_batch_unique
  ON campaign_send_batches (campaign_id, batch_id);

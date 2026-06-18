CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  payload TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  maxAttempts INTEGER NOT NULL DEFAULT 3,
  lastError TEXT,
  scheduledAt INTEGER NOT NULL DEFAULT (unixepoch()),
  startedAt INTEGER,
  completedAt INTEGER,
  createdAt INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_jobs_status_scheduled ON jobs(status, scheduledAt);
CREATE INDEX IF NOT EXISTS idx_jobs_type ON jobs(type);


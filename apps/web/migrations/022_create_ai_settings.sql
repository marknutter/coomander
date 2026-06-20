-- App-wide key/value settings. Holds AI Gateway / chat settings (e.g. the
-- active default chat model id) under namespaced keys (AI Gateway — #203).
CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_by TEXT REFERENCES user(id) ON DELETE SET NULL
);

-- Provider API keys, encrypted at rest (AES-GCM via lib/secrets-crypto). One
-- row per provider. The plaintext key is NEVER stored or returned to clients;
-- encrypted_key holds the versioned ciphertext, key_hint holds a last-4 mask.
CREATE TABLE IF NOT EXISTS provider_keys (
  provider TEXT PRIMARY KEY,
  encrypted_key TEXT NOT NULL,
  key_hint TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_by TEXT REFERENCES user(id) ON DELETE SET NULL
);

-- NOTE: no `-- DOWN` / rollback section. `wrangler d1 migrations apply` runs the
-- whole file as raw SQL (it does not parse an UP/DOWN marker), so a DOWN block
-- containing DROP statements would execute on D1 and immediately undo this
-- migration. DOWN sections are intentionally omitted from all migration files.

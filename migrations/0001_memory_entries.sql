CREATE TABLE IF NOT EXISTS memory_entries (
  id TEXT PRIMARY KEY NOT NULL,
  scope TEXT NOT NULL,
  scope_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  temperature TEXT NOT NULL DEFAULT 'warm',
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  last_accessed_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  access_count INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_memory_scope
  ON memory_entries(scope, scope_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_memory_scope_key
  ON memory_entries(scope, scope_id, key);

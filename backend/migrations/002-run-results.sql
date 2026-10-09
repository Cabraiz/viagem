CREATE TABLE IF NOT EXISTS run_results (
  run_id TEXT PRIMARY KEY,
  victory INTEGER NOT NULL CHECK (victory IN (0, 1)),
  rounds INTEGER NOT NULL CHECK (rounds BETWEEN 0 AND 10),
  duration_seconds INTEGER NOT NULL CHECK (duration_seconds >= 0),
  player_count INTEGER NOT NULL CHECK (player_count BETWEEN 1 AND 6),
  payload TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (length(run_id) BETWEEN 8 AND 64),
  CHECK (length(payload) <= 16384),
  CHECK (length(payload_hash) = 64)
);

CREATE INDEX IF NOT EXISTS run_results_created_at ON run_results (created_at);

INSERT INTO schema_migrations (version) VALUES (2) ON CONFLICT (version) DO NOTHING;

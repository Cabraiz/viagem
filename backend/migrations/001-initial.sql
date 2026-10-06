CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS players (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL COLLATE NOCASE UNIQUE,
  display_name TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (length(username) BETWEEN 3 AND 32),
  CHECK (username NOT GLOB '*[^a-z0-9_]*'),
  CHECK (length(display_name) BETWEEN 1 AND 40)
);

CREATE TABLE IF NOT EXISTS characters (
  player_id TEXT PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
  class_id TEXT NOT NULL,
  emblem_color TEXT NOT NULL,
  level INTEGER NOT NULL DEFAULT 1 CHECK (level >= 1),
  experience INTEGER NOT NULL DEFAULT 0 CHECK (experience >= 0),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

INSERT INTO schema_migrations (version) VALUES (1) ON CONFLICT (version) DO NOTHING;

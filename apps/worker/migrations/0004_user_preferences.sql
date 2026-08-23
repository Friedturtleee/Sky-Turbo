CREATE TABLE IF NOT EXISTS user_preferences (
  user_id TEXT NOT NULL,
  preference_key TEXT NOT NULL,
  payload TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, preference_key)
);

CREATE INDEX IF NOT EXISTS idx_user_preferences_updated
  ON user_preferences (user_id, updated_at DESC);

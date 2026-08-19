CREATE TABLE IF NOT EXISTS bookmarks (
  user_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_bookmarks_user_created
  ON bookmarks (user_id, created_at DESC);

